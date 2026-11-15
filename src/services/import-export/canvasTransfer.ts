import type {
  AttachmentRecord,
  BackupAttachment,
  Canvas,
  CanvasViewport,
  Note,
  NoteLayout,
  Project,
} from '../../types';
import {
  APP_VERSION,
  CANVAS_MAX_ZOOM,
  CANVAS_MIN_ZOOM,
} from '../../types';
import { createId, formatFileDate, nowIso } from '../../lib/utils';
import { htmlToMarkdown, markdownToHtml, sanitizeNoteHtml, textFromHtml } from '../../lib/richText';
import { getDb } from '../db/database';
import {
  DEFAULT_CANVAS_NAME,
  DEFAULT_PROJECT_NAME,
  LIMITS,
  NOTE_GAP,
  defaultCanvasViewport,
  defaultNoteLayout,
  sortProjects,
} from '../db/repository';
import { base64ToBlob, blobToBase64 } from '../db/attachments';

export const CANVAS_TRANSFER_FORMAT = 'clipcanvas-canvas';
export const CANVAS_TRANSFER_SCHEMA_VERSION = 1;

type CanvasTransferKind = 'note' | 'image';
type CanvasTransferDisplayMode = 'edit' | 'preview';

/**
 * The self-contained payload stored in a canvas JSON file. IDs are kept so
 * attachments can still be matched to their notes, but every ID is replaced
 * with a fresh one when the file is imported.
 */
export interface CanvasTransferNote {
  id: string;
  title: string;
  kind?: CanvasTransferKind;
  content: string;
  contentHtml?: string;
  contentText?: string;
  displayMode?: CanvasTransferDisplayMode;
  layout?: NoteLayout;
  browserCapture?: boolean;
  hasUnseenUpdate?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CanvasTransferFile {
  format: typeof CANVAS_TRANSFER_FORMAT;
  schemaVersion: number;
  exportedAt: string;
  appVersion: string;
  canvas: {
    name: string;
    viewport: CanvasViewport;
  };
  notes: CanvasTransferNote[];
  attachments: BackupAttachment[];
}

export interface ValidatedCanvasTransfer {
  exportedAt: string;
  appVersion: string;
  schemaVersion: number;
  canvas: {
    name: string;
    viewport: CanvasViewport;
  };
  notes: CanvasTransferNote[];
  attachments: BackupAttachment[];
}

export interface CanvasTransferResult {
  canvas: Canvas;
  notesAdded: number;
  attachmentsAdded: number;
}

export interface CanvasMergeResult {
  canvasName: string;
  notesAdded: number;
  attachmentsAdded: number;
}

export class CanvasTransferError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    const preview = issues.slice(0, 6).map((issue) => `• ${issue}`).join('\n');
    super(
      issues.length > 6
        ? `This canvas file could not be imported:\n${preview}\n• …and ${issues.length - 6} more issue(s).`
        : `This canvas file could not be imported:\n${preview}`,
    );
    this.name = 'CanvasTransferError';
    this.issues = issues;
  }
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function readViewport(value: unknown): CanvasViewport {
  if (!isRecord(value)) return defaultCanvasViewport();
  return {
    x: finiteNumber(value.x, 0),
    y: finiteNumber(value.y, 0),
    zoom: Math.min(
      CANVAS_MAX_ZOOM,
      Math.max(CANVAS_MIN_ZOOM, finiteNumber(value.zoom, 1)),
    ),
  };
}

function readLayout(value: unknown): NoteLayout | undefined {
  if (!isRecord(value)) return undefined;
  return {
    x: finiteNumber(value.x, 0),
    y: finiteNumber(value.y, 0),
    width: Math.min(1600, Math.max(280, finiteNumber(value.width, 430))),
    height: Math.min(1600, Math.max(80, finiteNumber(value.height, 340))),
    zIndex: Math.max(1, Math.round(finiteNumber(value.zIndex, 1))),
    ...(value.heightLocked === true ? { heightLocked: true } : {}),
    ...(typeof value.widthLocked === 'boolean'
      ? { widthLocked: value.widthLocked }
      : {}),
  };
}

function asString(
  value: unknown,
  field: string,
  issues: string[],
  options: { max?: number; allowEmpty?: boolean; trim?: boolean } = {},
): string {
  if (typeof value !== 'string') {
    issues.push(`${field} must be text.`);
    return '';
  }
  const result = options.trim ? value.trim() : value;
  if (!options.allowEmpty && !result.trim()) {
    issues.push(`${field} cannot be empty.`);
  }
  if (options.max !== undefined && result.length > options.max) {
    issues.push(`${field} is longer than the ${options.max}-character limit.`);
  }
  return result;
}

function readTimestamp(value: unknown, field: string, issues: string[]): string {
  if (typeof value !== 'string') {
    issues.push(`${field} must be a timestamp.`);
    return nowIso();
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    issues.push(`${field} is not a valid timestamp.`);
    return nowIso();
  }
  return date.toISOString();
}

function readId(value: unknown, field: string, issues: string[], seen: Set<string>): string {
  if (typeof value !== 'string' || !value.trim()) {
    issues.push(`${field} must have a stable ID.`);
    return '';
  }
  if (value.length > 160) {
    issues.push(`${field} has an invalid ID.`);
  }
  if (seen.has(value)) {
    issues.push(`${field} has a duplicate ID (${value}).`);
  }
  seen.add(value);
  return value;
}

function cleanCanvasName(name: string): string {
  const value = name.normalize('NFKC').trim().replace(/\s+/g, ' ');
  return (value || DEFAULT_CANVAS_NAME).slice(0, LIMITS.canvasName);
}

function toTransferNote(note: Note): CanvasTransferNote {
  const contentHtml = note.contentHtml ?? markdownToHtml(note.content);
  return {
    id: note.id,
    title: note.title,
    kind: note.kind === 'image' ? 'image' : 'note',
    content: note.content,
    contentHtml,
    contentText: note.contentText ?? (textFromHtml(contentHtml) || note.content),
    displayMode: note.displayMode === 'preview' ? 'preview' : 'edit',
    layout: note.layout,
    ...(note.browserCapture === true ? { browserCapture: true } : {}),
    ...(note.hasUnseenUpdate === true ? { hasUnseenUpdate: true } : {}),
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  };
}

/** Reads one canvas and everything needed to restore it on another machine. */
export async function createCanvasTransfer(canvasId: string): Promise<CanvasTransferFile> {
  const db = await getDb();
  const tx = db.transaction(['canvases', 'notes', 'attachments'], 'readonly');
  const canvas = await tx.objectStore('canvases').get(canvasId);
  if (!canvas) {
    await tx.done.catch(() => undefined);
    throw new Error('That canvas no longer exists.');
  }
  const notes = await tx.objectStore('notes').index('by-canvas').getAll(canvasId);
  const attachmentRecords: AttachmentRecord[] = [];
  for (const note of notes) {
    attachmentRecords.push(
      ...(await tx.objectStore('attachments').index('by-note').getAll(note.id)),
    );
  }
  await tx.done;

  const attachments: BackupAttachment[] = [];
  for (const record of attachmentRecords) {
    const { blob, ...metadata } = record;
    attachments.push({ ...metadata, dataBase64: await blobToBase64(blob) });
  }

  return {
    format: CANVAS_TRANSFER_FORMAT,
    schemaVersion: CANVAS_TRANSFER_SCHEMA_VERSION,
    exportedAt: nowIso(),
    appVersion: APP_VERSION,
    canvas: {
      name: canvas.name || DEFAULT_CANVAS_NAME,
      viewport: canvas.viewport,
    },
    notes: notes.map(toTransferNote),
    attachments,
  };
}

export function serializeCanvasTransfer(transfer: CanvasTransferFile): string {
  return `${JSON.stringify(transfer, null, 2)}\n`;
}

export function canvasTransferFilename(name: string, date = new Date()): string {
  const stem =
    name
      .normalize('NFKC')
      .replace(/["\\/:*?<>|\u0000-\u001f]+/g, '-')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 70) || 'canvas';
  return `canvas-${stem}-${formatFileDate(date)}.json`;
}

/**
 * Validates a canvas file in memory. Nothing is written until the caller asks
 * for a merge or a new canvas, so a malformed file can never damage the
 * notebook.
 */
export function validateCanvasTransfer(raw: unknown): ValidatedCanvasTransfer {
  const issues: string[] = [];
  if (!isRecord(raw)) {
    throw new CanvasTransferError(['The file is not a JSON object.']);
  }
  if (raw.format !== CANVAS_TRANSFER_FORMAT) {
    issues.push('This is not a ClipCanvas canvas file.');
  }
  const schemaVersion = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : NaN;
  if (!Number.isInteger(schemaVersion)) {
    issues.push('The canvas file is missing a valid schema version.');
  } else if (schemaVersion > CANVAS_TRANSFER_SCHEMA_VERSION) {
    issues.push(
      `This canvas uses schema version ${schemaVersion}, but this version of ClipCanvas supports up to ${CANVAS_TRANSFER_SCHEMA_VERSION}. Update ClipCanvas and try again.`,
    );
  } else if (schemaVersion < 1) {
    issues.push('The canvas schema version is not supported.');
  }

  const exportedAt = readTimestamp(raw.exportedAt, 'Export date', issues);
  const appVersion =
    typeof raw.appVersion === 'string' && raw.appVersion.trim()
      ? raw.appVersion.trim().slice(0, 40)
      : 'unknown';

  if (!isRecord(raw.canvas)) {
    throw new CanvasTransferError([
      ...issues,
      'The canvas file is missing its canvas details.',
    ]);
  }
  const canvasName = asString(raw.canvas.name, 'Canvas name', issues, {
    max: LIMITS.canvasName,
    trim: true,
  });
  const viewport = readViewport(raw.canvas.viewport);

  if (!Array.isArray(raw.notes)) {
    throw new CanvasTransferError([...issues, 'The canvas file must contain a notes list.']);
  }

  const noteIds = new Set<string>();
  const notes: CanvasTransferNote[] = [];
  raw.notes.forEach((rawNote, index) => {
    if (!isRecord(rawNote)) {
      issues.push(`Note #${index + 1} is not an object.`);
      return;
    }
    const id = readId(rawNote.id, `Note #${index + 1}`, issues, noteIds);
    if (!id) return;
    const title =
      rawNote.title == null
        ? ''
        : asString(rawNote.title, `Note #${index + 1} title`, issues, {
            max: LIMITS.noteTitle,
            allowEmpty: true,
          });
    const kind: CanvasTransferKind = rawNote.kind === 'image' ? 'image' : 'note';
    let content =
      rawNote.content == null
        ? ''
        : asString(rawNote.content, `Note #${index + 1} content`, issues, {
            max: LIMITS.noteContent,
            allowEmpty: true,
          });
    const rawHtml =
      rawNote.contentHtml == null
        ? ''
        : asString(rawNote.contentHtml, `Note #${index + 1} rich content`, issues, {
            max: LIMITS.noteContent,
            allowEmpty: true,
          });
    const contentHtml = rawHtml ? sanitizeNoteHtml(rawHtml) : markdownToHtml(content);
    if (!content && kind !== 'image' && contentHtml) {
      content = htmlToMarkdown(contentHtml);
    }
    const contentText =
      rawNote.contentText == null
        ? textFromHtml(contentHtml) || content
        : asString(rawNote.contentText, `Note #${index + 1} text`, issues, {
            max: LIMITS.noteContent,
            allowEmpty: true,
          });

    notes.push({
      id,
      title,
      kind,
      content,
      contentHtml,
      contentText,
      displayMode: rawNote.displayMode === 'preview' ? 'preview' : 'edit',
      layout: readLayout(rawNote.layout),
      ...(rawNote.browserCapture === true ? { browserCapture: true } : {}),
      ...(rawNote.hasUnseenUpdate === true ? { hasUnseenUpdate: true } : {}),
      createdAt: readTimestamp(rawNote.createdAt, `Note #${index + 1} created date`, issues),
      updatedAt: readTimestamp(rawNote.updatedAt, `Note #${index + 1} updated date`, issues),
    });
  });

  const attachments: BackupAttachment[] = [];
  const attachmentIds = new Set<string>();
  if (raw.attachments != null && !Array.isArray(raw.attachments)) {
    issues.push('The canvas attachments list is invalid.');
  } else if (Array.isArray(raw.attachments)) {
    raw.attachments.forEach((rawAttachment, index) => {
      if (!isRecord(rawAttachment)) {
        issues.push(`Attachment #${index + 1} is not an object.`);
        return;
      }
      const id = readId(
        rawAttachment.id,
        `Attachment #${index + 1}`,
        issues,
        attachmentIds,
      );
      const noteId =
        typeof rawAttachment.noteId === 'string' ? rawAttachment.noteId : '';
      if (!id || !noteIds.has(noteId)) {
        issues.push(`Attachment #${index + 1} refers to a note that is not in the file.`);
        return;
      }
      const mimeType =
        typeof rawAttachment.mimeType === 'string' &&
        rawAttachment.mimeType.startsWith('image/')
          ? rawAttachment.mimeType.slice(0, 120)
          : '';
      if (!mimeType) {
        issues.push(`Attachment #${index + 1} has an unsupported file type.`);
      }
      const dataBase64 =
        typeof rawAttachment.dataBase64 === 'string' ? rawAttachment.dataBase64 : '';
      if (!dataBase64) {
        issues.push(`Attachment #${index + 1} is missing its image bytes.`);
      }
      attachments.push({
        id,
        noteId,
        projectId: '',
        mimeType: mimeType || 'image/webp',
        width: Math.max(1, Math.round(finiteNumber(rawAttachment.width, 1))),
        height: Math.max(1, Math.round(finiteNumber(rawAttachment.height, 1))),
        byteSize: Math.max(0, Math.round(finiteNumber(rawAttachment.byteSize, 0))),
        createdAt: readTimestamp(
          rawAttachment.createdAt,
          `Attachment #${index + 1} created date`,
          issues,
        ),
        dataBase64,
      });
    });
  }

  if (issues.length > 0) {
    throw new CanvasTransferError(issues);
  }

  return {
    exportedAt,
    appVersion,
    schemaVersion: CANVAS_TRANSFER_SCHEMA_VERSION,
    canvas: {
      name: cleanCanvasName(canvasName),
      viewport,
    },
    notes,
    attachments,
  };
}

export function parseCanvasTransferJson(text: string): ValidatedCanvasTransfer {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new CanvasTransferError([
      'The selected file is not valid JSON. Choose a canvas file exported by ClipCanvas.',
    ]);
  }
  return validateCanvasTransfer(parsed);
}

export async function readCanvasTransferFile(file: File): Promise<ValidatedCanvasTransfer> {
  let text: string;
  try {
    text = await file.text();
  } catch {
    throw new CanvasTransferError(['The selected file could not be read.']);
  }
  return parseCanvasTransferJson(text);
}

function remapAttachmentReferences(html: string, idMap: Map<string, string>): string {
  if (!html || idMap.size === 0) return html;
  let result = html;
  for (const [oldId, newId] of idMap) {
    if (oldId === newId) continue;
    result = result
      .split(`data-attachment-id="${oldId}"`)
      .join(`data-attachment-id="${newId}"`);
  }
  return result;
}

function buildImportedNote(
  imported: CanvasTransferNote,
  id: string,
  projectId: string,
  canvasId: string,
  layout: NoteLayout,
  contentHtml: string,
): Note {
  return {
    id,
    projectId,
    canvasId,
    title: imported.title,
    kind: imported.kind === 'image' ? 'image' : 'note',
    content: imported.content,
    contentHtml,
    contentText: imported.contentText ?? (textFromHtml(contentHtml) || imported.content),
    displayMode: imported.displayMode === 'preview' ? 'preview' : 'edit',
    layout: {
      ...layout,
      widthLocked: imported.layout?.widthLocked === true,
    },
    ...(imported.browserCapture === true ? { browserCapture: true } : {}),
    ...(imported.hasUnseenUpdate === true ? { hasUnseenUpdate: true } : {}),
    createdAt: imported.createdAt,
    updatedAt: imported.updatedAt,
  };
}

function buildAttachmentRecord(
  imported: BackupAttachment,
  id: string,
  noteId: string,
  projectId: string,
): AttachmentRecord {
  const { dataBase64, ...metadata } = imported;
  const blob = base64ToBlob(dataBase64, metadata.mimeType);
  return {
    ...metadata,
    id,
    noteId,
    projectId,
    byteSize: blob.size,
    blob,
  };
}

/**
 * Creates a brand-new canvas from a file. The imported name is used as-is and
 * the new canvas shows up in the tab bar and sidebar like any other canvas.
 */
export async function createCanvasFromTransfer(
  transfer: ValidatedCanvasTransfer,
  projectId?: string | null,
): Promise<CanvasTransferResult> {
  const db = await getDb();
  const tx = db.transaction(['projects', 'canvases', 'notes', 'attachments'], 'readwrite');
  const projectStore = tx.objectStore('projects');
  const canvasStore = tx.objectStore('canvases');
  const noteStore = tx.objectStore('notes');
  const attachmentStore = tx.objectStore('attachments');
  const timestamp = nowIso();

  let project: Project | undefined;
  if (projectId) {
    project = await projectStore.get(projectId);
  }
  if (!project) {
    const existing = sortProjects(await projectStore.getAll())[0];
    if (existing) {
      project = existing;
    } else {
      project = {
        id: createId(),
        name: DEFAULT_PROJECT_NAME,
        description: '',
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      await projectStore.add(project);
    }
  }

  const canvas: Canvas = {
    id: createId(),
    projectId: project.id,
    name: cleanCanvasName(transfer.canvas.name),
    viewport: transfer.canvas.viewport,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  const noteIdMap = new Map<string, string>();
  for (const imported of transfer.notes) {
    noteIdMap.set(imported.id, createId());
  }
  const attachmentIdMap = new Map<string, string>();
  for (const attachment of transfer.attachments) {
    if (noteIdMap.has(attachment.noteId)) {
      attachmentIdMap.set(attachment.id, createId());
    }
  }

  const notes = transfer.notes.map((imported, index) =>
    buildImportedNote(
      imported,
      noteIdMap.get(imported.id) as string,
      project.id,
      canvas.id,
      imported.layout ?? defaultNoteLayout(index),
      remapAttachmentReferences(
        imported.contentHtml ?? markdownToHtml(imported.content),
        attachmentIdMap,
      ),
    ),
  );

  const attachmentRecords: AttachmentRecord[] = [];
  for (const attachment of transfer.attachments) {
    const noteId = noteIdMap.get(attachment.noteId);
    const id = attachmentIdMap.get(attachment.id);
    if (!noteId || !id) continue;
    attachmentRecords.push(buildAttachmentRecord(attachment, id, noteId, project.id));
  }

  await canvasStore.add(canvas);
  for (const note of notes) await noteStore.add(note);
  for (const record of attachmentRecords) await attachmentStore.add(record);
  await projectStore.put({ ...project, updatedAt: timestamp });
  await tx.done;

  return {
    canvas,
    notesAdded: notes.length,
    attachmentsAdded: attachmentRecords.length,
  };
}

/**
 * Merges a file into the canvas that is already open. Existing notes are left
 * untouched, the canvas keeps its name, and imported elements are shifted to
 * the right so both sets remain visible side by side.
 */
export async function mergeCanvasTransfer(
  transfer: ValidatedCanvasTransfer,
  targetCanvasId: string,
): Promise<CanvasMergeResult> {
  const db = await getDb();
  const tx = db.transaction(['projects', 'canvases', 'notes', 'attachments'], 'readwrite');
  const projectStore = tx.objectStore('projects');
  const canvasStore = tx.objectStore('canvases');
  const noteStore = tx.objectStore('notes');
  const attachmentStore = tx.objectStore('attachments');
  const timestamp = nowIso();

  const canvas = await canvasStore.get(targetCanvasId);
  if (!canvas) {
    await tx.done.catch(() => undefined);
    throw new Error('That canvas no longer exists.');
  }
  const project = await projectStore.get(canvas.projectId);
  const existingNotes = await noteStore.index('by-canvas').getAll(targetCanvasId);

  const existingLayouts = existingNotes
    .map((note) => note.layout)
    .filter((layout): layout is NoteLayout => Boolean(layout));
  const existingRight = existingLayouts.length
    ? Math.max(...existingLayouts.map((layout) => layout.x + layout.width))
    : 0;
  const existingMaxZ = existingLayouts.reduce(
    (max, layout) => Math.max(max, layout.zIndex),
    0,
  );

  const importedLayouts = transfer.notes.map(
    (note, index) => note.layout ?? defaultNoteLayout(index),
  );
  const importedMinX = importedLayouts.length
    ? Math.min(...importedLayouts.map((layout) => layout.x))
    : 0;
  const importedMinZ = importedLayouts.length
    ? Math.min(...importedLayouts.map((layout) => layout.zIndex))
    : 0;
  const offsetX =
    existingLayouts.length > 0
      ? Math.max(0, existingRight + NOTE_GAP - importedMinX)
      : 0;

  const noteIdMap = new Map<string, string>();
  for (const imported of transfer.notes) {
    noteIdMap.set(imported.id, createId());
  }
  const attachmentIdMap = new Map<string, string>();
  for (const attachment of transfer.attachments) {
    if (noteIdMap.has(attachment.noteId)) {
      attachmentIdMap.set(attachment.id, createId());
    }
  }

  const notes = transfer.notes.map((imported, index) => {
    const base = imported.layout ?? defaultNoteLayout(index);
    const layout: NoteLayout = {
      ...base,
      x: Math.round(base.x + offsetX),
      zIndex: Math.max(1, existingMaxZ + (base.zIndex - importedMinZ) + 1),
    };
    return buildImportedNote(
      imported,
      noteIdMap.get(imported.id) as string,
      canvas.projectId,
      canvas.id,
      layout,
      remapAttachmentReferences(
        imported.contentHtml ?? markdownToHtml(imported.content),
        attachmentIdMap,
      ),
    );
  });

  const attachmentRecords: AttachmentRecord[] = [];
  for (const attachment of transfer.attachments) {
    const noteId = noteIdMap.get(attachment.noteId);
    const id = attachmentIdMap.get(attachment.id);
    if (!noteId || !id) continue;
    attachmentRecords.push(
      buildAttachmentRecord(attachment, id, noteId, canvas.projectId),
    );
  }

  for (const note of notes) await noteStore.add(note);
  for (const record of attachmentRecords) await attachmentStore.add(record);
  await canvasStore.put({ ...canvas, updatedAt: timestamp });
  if (project) await projectStore.put({ ...project, updatedAt: timestamp });
  await tx.done;

  return {
    canvasName: canvas.name,
    notesAdded: notes.length,
    attachmentsAdded: attachmentRecords.length,
  };
}
