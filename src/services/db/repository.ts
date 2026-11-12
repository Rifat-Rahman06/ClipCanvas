import type { IDBPDatabase, IDBPTransaction } from 'idb';
import type {
  AppSettings,
  Canvas,
  CanvasInput,
  CanvasViewport,
  Note,
  NoteInput,
  NoteLayout,
  NotePatch,
  NotebookDataset,
  Project,
  ProjectInput,
} from '../../types';
import {
  CANVAS_MAX_ZOOM,
  CANVAS_MIN_ZOOM,
  DEFAULT_NOTE_WIDTH_DEFAULT,
} from '../../types';
import { createId, nowIso } from '../../lib/utils';
import { markdownToHtml, sanitizeNoteHtml, textFromHtml } from '../../lib/richText';
import { getDb, SETTINGS_KEY, type ClipCanvasDB } from './database';
import { revokeAllAttachmentUrls, revokeAttachmentUrls } from './attachments';
import { defaultSettings, normalizeSettings } from './settings';

export const NOTE_WIDTH_DEFAULT = DEFAULT_NOTE_WIDTH_DEFAULT;
export const NOTE_HEIGHT_DEFAULT = 340;
export const NOTE_GAP = 48;
export const DEFAULT_CANVAS_NAME = 'Main canvas';
export const DEFAULT_PROJECT_NAME = 'Notebook';

export const LIMITS = {
  projectName: 120,
  projectDescription: 4000,
  canvasName: 120,
  noteTitle: 300,
  noteContent: 2_000_000,
} as const;

export class NotebookDataError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'NotebookDataError';
  }
}

function cleanProjectName(name: string): string {
  const value = name.normalize('NFKC').trim().replace(/\s+/g, ' ');
  if (!value) throw new NotebookDataError('Project name cannot be empty.');
  if (value.length > LIMITS.projectName) {
    throw new NotebookDataError(`Project name must be ${LIMITS.projectName} characters or fewer.`);
  }
  return value;
}

function cleanDescription(description: string | undefined): string {
  const value = (description ?? '').trim();
  if (value.length > LIMITS.projectDescription) {
    throw new NotebookDataError(
      `Project description must be ${LIMITS.projectDescription} characters or fewer.`,
    );
  }
  return value;
}

export function cleanCanvasName(name: string): string {
  const value = name.normalize('NFKC').trim().replace(/\s+/g, ' ');
  if (!value) throw new NotebookDataError('Canvas name cannot be empty.');
  if (value.length > LIMITS.canvasName) {
    throw new NotebookDataError(`Canvas name must be ${LIMITS.canvasName} characters or fewer.`);
  }
  return value;
}

function cleanTitle(title: string | undefined): string {
  const value = title ?? '';
  if (value.length > LIMITS.noteTitle) {
    throw new NotebookDataError(`Note title must be ${LIMITS.noteTitle} characters or fewer.`);
  }
  return value;
}

function cleanContent(content: string | undefined): string {
  const value = content ?? '';
  if (value.length > LIMITS.noteContent) {
    throw new NotebookDataError('This note is too large to save.');
  }
  return value;
}

export function defaultCanvasViewport(): CanvasViewport {
  return { x: 0, y: 0, zoom: 1 };
}

export function defaultNoteLayout(index = 0, width = NOTE_WIDTH_DEFAULT): NoteLayout {
  return {
    x: 48 + (index % 3) * (width + NOTE_GAP),
    y: 72 + Math.floor(index / 3) * (NOTE_HEIGHT_DEFAULT + NOTE_GAP),
    width,
    height: NOTE_HEIGHT_DEFAULT,
    zIndex: index + 1,
    widthLocked: false,
  };
}

function nextLayoutIndex(notes: Note[], width = NOTE_WIDTH_DEFAULT): number {
  const occupied = new Set(
    notes
      .filter((note) => note.layout)
      .map((note) => {
        const layout = note.layout as NoteLayout;
        return `${Math.round(layout.x)}:${Math.round(layout.y)}`;
      }),
  );
  for (let index = 0; index < 10_000; index += 1) {
    const candidate = defaultNoteLayout(index, width);
    if (!occupied.has(`${candidate.x}:${candidate.y}`)) return index;
  }
  return notes.length;
}

function cleanLayout(
  layout: NoteLayout | undefined,
  fallbackIndex = 0,
  baseWidth = NOTE_WIDTH_DEFAULT,
): NoteLayout {
  const base = defaultNoteLayout(fallbackIndex, baseWidth);
  if (!layout) return base;
  const finite = (value: unknown, fallback: number) =>
    typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return {
    x: finite(layout.x, base.x),
    y: finite(layout.y, base.y),
    width: Math.min(1600, Math.max(280, finite(layout.width, base.width))),
    height: Math.min(1600, Math.max(80, finite(layout.height, base.height))),
    zIndex: Math.max(1, Math.round(finite(layout.zIndex, base.zIndex))),
    ...(layout.heightLocked ? { heightLocked: true } : {}),
    ...(typeof layout.widthLocked === 'boolean'
      ? { widthLocked: layout.widthLocked }
      : {}),
  };
}

function cleanViewport(viewport: CanvasViewport | undefined): CanvasViewport {
  const base = defaultCanvasViewport();
  if (!viewport) return base;
  const finite = (value: unknown, fallback: number) =>
    typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return {
    x: finite(viewport.x, base.x),
    y: finite(viewport.y, base.y),
    zoom: Math.min(
      CANVAS_MAX_ZOOM,
      Math.max(CANVAS_MIN_ZOOM, finite(viewport.zoom, base.zoom)),
    ),
  };
}

function computeContent(
  content: string,
  contentHtml?: string,
  contentText?: string,
): { contentHtml: string; contentText: string } {
  const html =
    contentHtml === undefined
      ? markdownToHtml(content)
      : sanitizeNoteHtml(contentHtml);
  return {
    contentHtml: html,
    contentText: contentText === undefined ? textFromHtml(html) || content : contentText,
  };
}

async function assertProjectExists(
  projects: { get(id: string): Promise<Project | undefined> },
  projectId: string,
): Promise<Project> {
  const project = await projects.get(projectId);
  if (!project) {
    throw new NotebookDataError('That project no longer exists. Choose another project.');
  }
  return project;
}

async function firstCanvasForProject(
  canvases: { index(name: 'by-project'): { getAll(id: string): Promise<Canvas[]> } },
  projectId: string,
): Promise<Canvas | undefined> {
  const list = await canvases.index('by-project').getAll(projectId);
  return sortCanvases(list)[0];
}

function normalizeIso(value: string | null | undefined, field: string): string | null {
  if (value == null || value === '') return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new NotebookDataError(`Invalid ${field} timestamp.`);
  }
  return date.toISOString();
}

function buildNote(
  input: Omit<NoteInput, 'projectId' | 'canvasId'>,
  projectId: string,
  canvasId: string,
  timestamp: string,
  layoutIndex = 0,
  defaultWidth = NOTE_WIDTH_DEFAULT,
): Note {
  const createdAt = normalizeIso(input.createdAt, 'created') ?? timestamp;
  const updatedAt = normalizeIso(input.updatedAt, 'updated') ?? createdAt;
  const content = cleanContent(input.content);
  const rendered = computeContent(content, input.contentHtml, input.contentText);
  const layout = cleanLayout(
    input.layout ? { ...input.layout, width: defaultWidth } : undefined,
    layoutIndex,
    defaultWidth,
  );
  return {
    id: createId(),
    projectId,
    canvasId,
    title: cleanTitle(input.title),
    kind: input.kind === 'image' ? 'image' : 'note',
    content,
    contentHtml: cleanContent(rendered.contentHtml),
    contentText: cleanContent(rendered.contentText),
    layout: { ...layout, widthLocked: false },
    ...(input.browserCapture === true ? { browserCapture: true } : {}),
    ...(input.hasUnseenUpdate === true ? { hasUnseenUpdate: true } : {}),
    createdAt,
    updatedAt,
  };
}

function cleanStoredProject(project: Project): Project {
  return {
    id: project.id,
    name: project.name,
    description: project.description ?? '',
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
}

function cleanStoredCanvas(canvas: Canvas): Canvas {
  return {
    id: canvas.id,
    projectId: canvas.projectId,
    name: canvas.name || DEFAULT_CANVAS_NAME,
    viewport: cleanViewport(canvas.viewport),
    createdAt: canvas.createdAt,
    updatedAt: canvas.updatedAt,
  };
}

function cleanStoredNote(note: Note): Note {
  const content = note.content ?? '';
  const rendered = computeContent(content, note.contentHtml, note.contentText);
  return {
    id: note.id,
    projectId: note.projectId,
    canvasId: note.canvasId ?? '',
    title: note.title,
    kind: note.kind === 'image' ? 'image' : 'note',
    content,
    contentHtml: rendered.contentHtml,
    contentText: rendered.contentText,
    layout: cleanLayout(note.layout),
    ...(note.browserCapture === true ? { browserCapture: true } : {}),
    ...(note.hasUnseenUpdate === true ? { hasUnseenUpdate: true } : {}),
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  };
}

function buildCanvas(
  projectId: string,
  name: string,
  timestamp: string,
  viewport?: CanvasViewport,
): Canvas {
  return {
    id: createId(),
    projectId,
    name: cleanCanvasName(name || DEFAULT_CANVAS_NAME),
    viewport: cleanViewport(viewport),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export async function getSettings(): Promise<AppSettings> {
  const db = await getDb();
  const tx = db.transaction('settings', 'readonly');
  const value = await tx.store.get(SETTINGS_KEY);
  await tx.done;
  return normalizeSettings(value);
}

export async function updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const db = await getDb();
  const tx = db.transaction('settings', 'readwrite');
  const current = normalizeSettings(await tx.store.get(SETTINGS_KEY));
  const next = normalizeSettings({ ...current, ...patch });
  await tx.store.put(next, SETTINGS_KEY);
  await tx.done;
  return next;
}

export async function getDataset(): Promise<NotebookDataset> {
  const db = await getDb();
  const tx = db.transaction(['projects', 'canvases', 'notes', 'settings'], 'readonly');
  const [projects, canvases, notes, settings] = await Promise.all([
    tx.objectStore('projects').getAll(),
    tx.objectStore('canvases').getAll(),
    tx.objectStore('notes').getAll(),
    tx.objectStore('settings').get(SETTINGS_KEY),
  ]);
  await tx.done;
  return {
    projects: projects.map(cleanStoredProject),
    canvases: canvases.map(cleanStoredCanvas),
    notes: notes.map(cleanStoredNote),
    settings: normalizeSettings(settings),
  };
}

export async function getProject(id: string): Promise<Project | undefined> {
  const db = await getDb();
  return db.get('projects', id);
}

export async function getProjectCanvases(projectId: string): Promise<Canvas[]> {
  const db = await getDb();
  const canvases = await db.getAllFromIndex('canvases', 'by-project', projectId);
  return sortCanvases(canvases).map(cleanStoredCanvas);
}

export async function getDefaultCanvas(projectId: string): Promise<Canvas | undefined> {
  return (await getProjectCanvases(projectId))[0];
}

export async function createProject(input: ProjectInput): Promise<Project> {
  const db = await getDb();
  const timestamp = nowIso();
  const project: Project = {
    id: createId(),
    name: cleanProjectName(input.name),
    description: cleanDescription(input.description),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const canvas = buildCanvas(project.id, DEFAULT_CANVAS_NAME, timestamp);

  const tx = db.transaction(['projects', 'canvases'], 'readwrite');
  await tx.objectStore('projects').add(project);
  await tx.objectStore('canvases').add(canvas);
  await tx.done;
  return project;
}

export async function updateProject(
  id: string,
  patch: Partial<ProjectInput>,
): Promise<Project> {
  const db = await getDb();
  const tx = db.transaction('projects', 'readwrite');
  const store = tx.objectStore('projects');
  const existing = await store.get(id);
  if (!existing) {
    await tx.done.catch(() => undefined);
    throw new NotebookDataError('That project no longer exists.');
  }

  const updated: Project = {
    ...cleanStoredProject(existing),
    name: patch.name === undefined ? existing.name : cleanProjectName(patch.name),
    description:
      patch.description === undefined ? existing.description : cleanDescription(patch.description),
    updatedAt: nowIso(),
  };
  await store.put(updated);
  await tx.done;
  return updated;
}

export async function createCanvas(input: CanvasInput): Promise<Canvas> {
  const db = await getDb();
  const timestamp = nowIso();
  const tx = db.transaction(['projects', 'canvases'], 'readwrite');
  const projects = tx.objectStore('projects');
  let project: Project;
  if (input.projectId) {
    project = await assertProjectExists(projects, input.projectId);
  } else {
    // The file manager no longer exposes projects. Use the existing internal
    // container when present, otherwise create one implicitly for the canvas.
    const existing = sortProjects(await projects.getAll())[0];
    project =
      existing ?? {
        id: createId(),
        name: DEFAULT_PROJECT_NAME,
        description: '',
        createdAt: timestamp,
        updatedAt: timestamp,
      };
    if (!existing) await projects.add(project);
  }
  const canvas = buildCanvas(project.id, input.name, timestamp);
  await tx.objectStore('canvases').add(canvas);
  await tx.objectStore('projects').put({ ...project, updatedAt: timestamp });
  await tx.done;
  return canvas;
}

export async function updateCanvas(
  id: string,
  patch: { name?: string },
): Promise<Canvas> {
  const db = await getDb();
  const tx = db.transaction('canvases', 'readwrite');
  const store = tx.objectStore('canvases');
  const existing = await store.get(id);
  if (!existing) {
    await tx.done.catch(() => undefined);
    throw new NotebookDataError('That canvas no longer exists.');
  }
  const updated: Canvas = {
    ...cleanStoredCanvas(existing),
    name: patch.name === undefined ? existing.name : cleanCanvasName(patch.name),
    updatedAt: nowIso(),
  };
  await store.put(updated);
  await tx.done;
  return updated;
}

export async function updateCanvasViewport(
  id: string,
  viewport: CanvasViewport,
): Promise<Canvas> {
  const db = await getDb();
  const tx = db.transaction('canvases', 'readwrite');
  const existing = await tx.store.get(id);
  if (!existing) {
    await tx.done.catch(() => undefined);
    throw new NotebookDataError('That canvas no longer exists.');
  }
  const updated: Canvas = { ...cleanStoredCanvas(existing), viewport: cleanViewport(viewport) };
  await tx.store.put(updated);
  await tx.done;
  return updated;
}

export async function deleteCanvas(id: string): Promise<{ deletedNoteIds: string[] }> {
  const db = await getDb();
  const tx = db.transaction(['canvases', 'notes', 'attachments'], 'readwrite');
  const canvas = await tx.objectStore('canvases').get(id);
  if (!canvas) {
    await tx.done.catch(() => undefined);
    throw new NotebookDataError('That canvas no longer exists.');
  }
  const notes = await tx.objectStore('notes').index('by-canvas').getAll(id);
  const attachmentKeys: IDBValidKey[] = [];
  for (const note of notes) {
    await tx.objectStore('notes').delete(note.id);
    const keys = await tx.objectStore('attachments').index('by-note').getAllKeys(note.id);
    attachmentKeys.push(...keys);
    for (const key of keys) await tx.objectStore('attachments').delete(key);
  }
  await tx.objectStore('canvases').delete(id);
  await tx.done;
  revokeAttachmentUrls(attachmentKeys.filter((key): key is string => typeof key === 'string'));
  return { deletedNoteIds: notes.map((note) => note.id) };
}

export async function deleteProject(id: string): Promise<{ deletedNoteIds: string[] }> {
  const db = await getDb();
  const tx = db.transaction(['projects', 'canvases', 'notes', 'attachments'], 'readwrite');
  const project = await tx.objectStore('projects').get(id);
  if (!project) {
    await tx.done.catch(() => undefined);
    throw new NotebookDataError('That project no longer exists.');
  }
  const notes = await tx.objectStore('notes').index('by-project').getAll(id);
  for (const note of notes) {
    await tx.objectStore('notes').delete(note.id);
  }
  const canvasKeys = await tx.objectStore('canvases').index('by-project').getAllKeys(id);
  for (const key of canvasKeys) {
    await tx.objectStore('canvases').delete(key);
  }
  const attachmentKeys = await tx
    .objectStore('attachments')
    .index('by-project')
    .getAllKeys(id);
  for (const key of attachmentKeys) {
    await tx.objectStore('attachments').delete(key);
  }
  await tx.objectStore('projects').delete(id);
  await tx.done;
  revokeAttachmentUrls(attachmentKeys.filter((key): key is string => typeof key === 'string'));
  return { deletedNoteIds: notes.map((note) => note.id) };
}

async function resolveCanvasForNewNote(
  tx: IDBPTransaction<ClipCanvasDB, ['projects', 'canvases', 'notes', 'settings'], 'readwrite'>,
  projectId: string,
  canvasId: string | undefined,
  timestamp: string,
): Promise<Canvas> {
  const canvases = tx.objectStore('canvases');
  if (canvasId) {
    const requested = await canvases.get(canvasId);
    if (!requested || requested.projectId !== projectId) {
      throw new NotebookDataError('That canvas is not part of this project.');
    }
    return requested;
  }
  const existing = await firstCanvasForProject(canvases, projectId);
  if (existing) return existing;
  const canvas = buildCanvas(projectId, DEFAULT_CANVAS_NAME, timestamp);
  await canvases.add(canvas);
  return canvas;
}

export async function createNote(input: NoteInput): Promise<Note> {
  const db = await getDb();
  const timestamp = nowIso();
  const tx = db.transaction(['projects', 'canvases', 'notes', 'settings'], 'readwrite');
  const settings = normalizeSettings(await tx.objectStore('settings').get(SETTINGS_KEY));
  const project = await assertProjectExists(tx.objectStore('projects'), input.projectId);
  const canvas = await resolveCanvasForNewNote(tx, input.projectId, input.canvasId, timestamp);
  const canvasNotes = await tx.objectStore('notes').index('by-canvas').getAll(canvas.id);
  const layoutIndex = nextLayoutIndex(canvasNotes, settings.defaultNoteWidth);
  const note = buildNote(
    input,
    input.projectId,
    canvas.id,
    timestamp,
    layoutIndex,
    settings.defaultNoteWidth,
  );
  await tx.objectStore('notes').add(note);
  await tx.objectStore('projects').put({ ...project, updatedAt: timestamp });
  await tx.done;
  return note;
}

/**
 * Creates a project, its first canvas, and its first note in one transaction.
 * Used by quick capture so cancelling or failing never leaves a half-created project.
 */
export async function createProjectWithNote(
  projectInput: ProjectInput,
  noteInput: Omit<NoteInput, 'projectId' | 'canvasId'>,
): Promise<{ project: Project; canvas: Canvas; note: Note }> {
  const db = await getDb();
  const timestamp = nowIso();
  const project: Project = {
    id: createId(),
    name: cleanProjectName(projectInput.name),
    description: cleanDescription(projectInput.description),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const canvas = buildCanvas(project.id, DEFAULT_CANVAS_NAME, timestamp);
  const tx = db.transaction(['projects', 'canvases', 'notes', 'settings'], 'readwrite');
  const settings = normalizeSettings(await tx.objectStore('settings').get(SETTINGS_KEY));
  const note = buildNote(noteInput, project.id, canvas.id, timestamp, 0, settings.defaultNoteWidth);

  await tx.objectStore('projects').add(project);
  await tx.objectStore('canvases').add(canvas);
  await tx.objectStore('notes').add(note);
  await tx.done;
  return { project, canvas, note };
}

export async function updateNote(id: string, patch: NotePatch): Promise<Note> {
  const db = await getDb();
  const tx = db.transaction(
    ['projects', 'canvases', 'notes', 'attachments'],
    'readwrite',
  );
  const notes = tx.objectStore('notes');
  const projects = tx.objectStore('projects');
  const canvases = tx.objectStore('canvases');
  const existing = await notes.get(id);
  if (!existing) {
    await tx.done.catch(() => undefined);
    throw new NotebookDataError('That note no longer exists.');
  }

  let projectId = patch.projectId ?? existing.projectId;
  let canvasId = patch.canvasId ?? existing.canvasId;

  if (patch.canvasId !== undefined) {
    const requested = await canvases.get(patch.canvasId);
    if (!requested) {
      await tx.done.catch(() => undefined);
      throw new NotebookDataError('That canvas no longer exists.');
    }
    if (patch.projectId === undefined) projectId = requested.projectId;
    canvasId = requested.id;
  }

  const targetProject = await assertProjectExists(projects, projectId);

  if (patch.canvasId !== undefined) {
    const requested = await canvases.get(patch.canvasId);
    if (!requested || requested.projectId !== projectId) {
      await tx.done.catch(() => undefined);
      throw new NotebookDataError('That canvas is not part of the selected project.');
    }
    canvasId = requested.id;
  } else if (projectId !== existing.projectId) {
    const fallback = await firstCanvasForProject(canvases, projectId);
    if (!fallback) {
      await tx.done.catch(() => undefined);
      throw new NotebookDataError('That project does not have a canvas yet.');
    }
    canvasId = fallback.id;
  } else if (!canvasId) {
    const fallback = await firstCanvasForProject(canvases, projectId);
    if (!fallback) {
      await tx.done.catch(() => undefined);
      throw new NotebookDataError('That project does not have a canvas yet.');
    }
    canvasId = fallback.id;
  }

  let content =
    patch.content === undefined ? existing.content ?? '' : cleanContent(patch.content);
  let contentHtml =
    patch.contentHtml === undefined
      ? existing.contentHtml ?? markdownToHtml(content)
      : sanitizeNoteHtml(patch.contentHtml);
  if (patch.contentHtml === undefined && patch.content !== undefined) {
    contentHtml = markdownToHtml(content);
  }
  contentHtml = cleanContent(contentHtml);
  const contentText =
    patch.contentText !== undefined
      ? cleanContent(patch.contentText)
      : patch.content !== undefined || patch.contentHtml !== undefined
        ? textFromHtml(contentHtml) || content
        : existing.contentText ?? (textFromHtml(contentHtml) || content);
  if (patch.contentHtml !== undefined && patch.content === undefined) {
    content = cleanContent(contentText);
  }

  const projectChanged = projectId !== existing.projectId;
  const canvasChanged = canvasId !== existing.canvasId;
  let layout = patch.layout === undefined ? existing.layout : cleanLayout(patch.layout);
  if (canvasChanged && patch.layout === undefined) {
    const targetNotes = await notes.index('by-canvas').getAll(canvasId);
    layout = defaultNoteLayout(nextLayoutIndex(targetNotes));
  }

  const nextTitle = patch.title === undefined ? existing.title : cleanTitle(patch.title);
  // The Updated indicator is controlled by the browser-capture workflow, which
  // sets this flag explicitly. Manually editing on the canvas must never mark a
  // note as updated.
  const nextHasUnseenUpdate =
    patch.hasUnseenUpdate !== undefined
      ? patch.hasUnseenUpdate
      : existing.hasUnseenUpdate === true;

  const timestamp = nowIso();
  const updated: Note = {
    id: existing.id,
    projectId,
    canvasId,
    title: nextTitle,
    kind: existing.kind === 'image' ? 'image' : 'note',
    content,
    contentHtml,
    contentText,
    layout: cleanLayout(layout),
    ...(patch.browserCapture === undefined
      ? existing.browserCapture === true
        ? { browserCapture: true }
        : {}
      : patch.browserCapture
        ? { browserCapture: true }
        : {}),
    ...(nextHasUnseenUpdate ? { hasUnseenUpdate: true } : {}),
    createdAt: existing.createdAt,
    updatedAt: timestamp,
  };
  await notes.put(updated);

  if (projectChanged) {
    const previousProject = await projects.get(existing.projectId);
    if (previousProject) {
      await projects.put({ ...previousProject, updatedAt: timestamp });
    }
    const attachmentKeys = await tx
      .objectStore('attachments')
      .index('by-note')
      .getAllKeys(id);
    for (const key of attachmentKeys) {
      const record = await tx.objectStore('attachments').get(key);
      if (record) {
        await tx.objectStore('attachments').put({ ...record, projectId });
      }
    }
  }
  await projects.put({ ...targetProject, updatedAt: timestamp });
  await tx.done;
  return updated;
}

/**
 * Layout changes happen continuously while dragging and resizing. They update
 * only the note record so project activity and note "last edited" stay stable.
 */
export async function updateNoteLayout(id: string, layout: NoteLayout): Promise<Note> {
  const db = await getDb();
  const tx = db.transaction('notes', 'readwrite');
  const existing = await tx.store.get(id);
  if (!existing) {
    await tx.done.catch(() => undefined);
    throw new NotebookDataError('That note no longer exists.');
  }
  const updated: Note = { ...existing, layout: cleanLayout(layout) };
  await tx.store.put(updated);
  await tx.done;
  return updated;
}

export async function deleteNote(id: string): Promise<Note> {
  const db = await getDb();
  const tx = db.transaction(['projects', 'notes', 'attachments'], 'readwrite');
  const note = await tx.objectStore('notes').get(id);
  if (!note) {
    await tx.done.catch(() => undefined);
    throw new NotebookDataError('That note no longer exists.');
  }
  await tx.objectStore('notes').delete(id);
  const attachmentKeys = await tx
    .objectStore('attachments')
    .index('by-note')
    .getAllKeys(id);
  for (const key of attachmentKeys) {
    await tx.objectStore('attachments').delete(key);
  }
  const project = await tx.objectStore('projects').get(note.projectId);
  if (project) {
    await tx.objectStore('projects').put({ ...project, updatedAt: nowIso() });
  }
  await tx.done;
  revokeAttachmentUrls(attachmentKeys.filter((key): key is string => typeof key === 'string'));
  return note;
}

export async function countNotesInCanvas(canvasId: string): Promise<number> {
  const db = await getDb();
  return db.countFromIndex('notes', 'by-canvas', canvasId);
}

export function sortProjects(projects: Project[]): Project[] {
  return [...projects].sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.name.localeCompare(b.name),
  );
}

export function sortCanvases(canvases: Canvas[]): Canvas[] {
  return [...canvases].sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.name.localeCompare(b.name),
  );
}

export function sortNotes(notes: Note[]): Note[] {
  return [...notes].sort(
    (a, b) => b.createdAt.localeCompare(a.createdAt) || a.title.localeCompare(b.title),
  );
}

export async function clearNotebookForTests(): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(
    ['projects', 'canvases', 'notes', 'settings', 'attachments'],
    'readwrite',
  );
  await Promise.all([
    tx.objectStore('projects').clear(),
    tx.objectStore('canvases').clear(),
    tx.objectStore('notes').clear(),
    tx.objectStore('settings').clear(),
    tx.objectStore('attachments').clear(),
  ]);
  await tx.objectStore('settings').put(defaultSettings(), SETTINGS_KEY);
  await tx.done;
  revokeAllAttachmentUrls();
}

export type NotebookDb = IDBPDatabase<ClipCanvasDB>;
