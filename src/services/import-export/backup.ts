import type {
  AppSettings,
  BackupAttachment,
  BackupFile,
  Canvas,
  CanvasViewport,
  ImportAnalysis,
  Note,
  NoteLayout,
  NotebookDataset,
  Project,
  ValidatedBackup,
} from '../../types';
import {
  APP_VERSION,
  BACKUP_FORMAT,
  CANVAS_MAX_ZOOM,
  CANVAS_MIN_ZOOM,
  LEGACY_BACKUP_FORMAT,
  SCHEMA_VERSION,
} from '../../types';
import { nowIso } from '../../lib/utils';
import { markdownToHtml, sanitizeNoteHtml, textFromHtml } from '../../lib/richText';
import { normalizeSettings } from '../db/settings';
import { DEFAULT_CANVAS_NAME, defaultCanvasViewport, LIMITS } from '../db/repository';
import { getBackupAttachments } from '../db/attachments';

export const MAX_BACKUP_BYTES = 64 * 1024 * 1024;

export class BackupValidationError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    const preview = issues.slice(0, 6).map((issue) => `• ${issue}`).join('\n');
    super(
      issues.length > 6
        ? `This backup could not be imported:\n${preview}\n• …and ${issues.length - 6} more issue(s).`
        : `This backup could not be imported:\n${preview}`,
    );
    this.name = 'BackupValidationError';
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

/**
 * Older notebooks and migration snapshots may not have canvas records yet.
 * Derive one default canvas per project so every export remains self-contained.
 */
function ensureBackupCanvases(
  projects: Project[],
  canvases: Canvas[],
  rawProjects: UnknownRecord[] = [],
): Canvas[] {
  const result = [...canvases];
  const byProject = new Map<string, Canvas[]>();
  for (const canvas of result) {
    const list = byProject.get(canvas.projectId) ?? [];
    list.push(canvas);
    byProject.set(canvas.projectId, list);
  }
  projects.forEach((project, index) => {
    if ((byProject.get(project.id)?.length ?? 0) > 0) return;
    const raw = rawProjects[index];
    const canvas: Canvas = {
      id: `default-canvas-${project.id}`,
      projectId: project.id,
      name: DEFAULT_CANVAS_NAME,
      viewport: readViewport(raw?.canvas),
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    };
    while (result.some((item) => item.id === canvas.id)) {
      canvas.id = `${canvas.id}-1`;
    }
    result.push(canvas);
    byProject.set(project.id, [canvas]);
  });
  return result;
}

export function createBackup(
  dataset: Partial<NotebookDataset>,
  exportedAt = nowIso(),
  attachments: BackupAttachment[] = [],
): BackupFile {
  const projects = (dataset.projects ?? []).map((project) => ({
    id: project.id,
    name: project.name,
    description: project.description ?? '',
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  }));
  const canvases = ensureBackupCanvases(projects, dataset.canvases ?? []).map((canvas) => ({
    id: canvas.id,
    projectId: canvas.projectId,
    name: canvas.name || DEFAULT_CANVAS_NAME,
    viewport: readViewport(canvas.viewport),
    createdAt: canvas.createdAt,
    updatedAt: canvas.updatedAt,
  }));
  const firstCanvasByProject = new Map<string, string>();
  for (const canvas of canvases) {
    if (!firstCanvasByProject.has(canvas.projectId)) {
      firstCanvasByProject.set(canvas.projectId, canvas.id);
    }
  }
  const canvasIds = new Set(canvases.map((canvas) => canvas.id));

  return {
    format: BACKUP_FORMAT,
    schemaVersion: SCHEMA_VERSION,
    exportedAt,
    appVersion: APP_VERSION,
    data: {
      projects,
      canvases,
      notes: (dataset.notes ?? []).map((note) => ({
        id: note.id,
        projectId: note.projectId,
        canvasId:
          note.canvasId && canvasIds.has(note.canvasId)
            ? note.canvasId
            : firstCanvasByProject.get(note.projectId) ?? '',
        title: note.title,
        kind: note.kind,
        content: note.content,
        contentHtml: note.contentHtml,
        contentText: note.contentText,
        layout: note.layout,
        ...(note.browserCapture === true ? { browserCapture: true } : {}),
        ...(note.hasUnseenUpdate === true ? { hasUnseenUpdate: true } : {}),
        createdAt: note.createdAt,
        updatedAt: note.updatedAt,
      })),
      settings: normalizeSettings(dataset.settings),
      attachments,
    },
  };
}

/** Includes stored image bytes in the JSON backup. */
export async function createBackupWithAttachments(
  dataset: NotebookDataset,
  exportedAt = nowIso(),
): Promise<BackupFile> {
  const attachments = await getBackupAttachments();
  return createBackup(dataset, exportedAt, attachments);
}

export function serializeBackup(backup: BackupFile): string {
  return `${JSON.stringify(backup, null, 2)}\n`;
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

/**
 * Validates and normalizes a backup in memory. No database writes happen here,
 * so a malformed file can never partially replace an existing notebook.
 */
export function validateBackup(raw: unknown): ValidatedBackup {
  const issues: string[] = [];
  if (!isRecord(raw)) {
    throw new BackupValidationError(['The file is not a JSON object.']);
  }
  if (raw.format !== BACKUP_FORMAT && raw.format !== LEGACY_BACKUP_FORMAT) {
    issues.push('This is not a ClipCanvas research-notebook backup.');
  }
  const schemaVersion = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : NaN;
  if (!Number.isInteger(schemaVersion)) {
    issues.push('The backup is missing a valid schema version.');
  } else if (schemaVersion > SCHEMA_VERSION) {
    issues.push(
      `This backup uses schema version ${schemaVersion}, but this version of ClipCanvas supports up to ${SCHEMA_VERSION}. Update ClipCanvas and try again.`,
    );
  } else if (schemaVersion < 1) {
    issues.push('The backup schema version is not supported.');
  }

  const exportedAt = readTimestamp(raw.exportedAt, 'Export date', issues);
  const appVersion =
    typeof raw.appVersion === 'string' && raw.appVersion.trim()
      ? raw.appVersion.trim().slice(0, 40)
      : 'unknown';

  if (!isRecord(raw.data)) {
    throw new BackupValidationError([...issues, 'The backup is missing its "data" object.']);
  }
  const data = raw.data;
  if (!Array.isArray(data.projects) || !Array.isArray(data.notes)) {
    throw new BackupValidationError([
      ...issues,
      'The backup must contain projects and notes lists.',
    ]);
  }

  const projectIds = new Set<string>();
  const projects: Project[] = [];
  const rawProjects = data.projects.filter(isRecord);

  data.projects.forEach((rawProject, index) => {
    if (!isRecord(rawProject)) {
      issues.push(`Project #${index + 1} is not an object.`);
      return;
    }
    const id = readId(rawProject.id, `Project #${index + 1}`, issues, projectIds);
    if (!id) return;
    const name = asString(rawProject.name, `Project #${index + 1} name`, issues, {
      max: LIMITS.projectName,
      trim: true,
    });
    if (!name) return;
    const description =
      rawProject.description == null
        ? ''
        : asString(rawProject.description, `Project "${name}" description`, issues, {
            max: LIMITS.projectDescription,
            allowEmpty: true,
          });
    projects.push({
      id,
      name,
      description,
      createdAt: readTimestamp(rawProject.createdAt, `Project "${name}" created date`, issues),
      updatedAt: readTimestamp(rawProject.updatedAt, `Project "${name}" updated date`, issues),
    });
  });

  const projectIdSet = new Set(projects.map((project) => project.id));
  const canvasIds = new Set<string>();
  const canvases: Canvas[] = [];

  if (data.canvases != null && !Array.isArray(data.canvases)) {
    issues.push('The backup canvases list is invalid.');
  } else if (Array.isArray(data.canvases)) {
    data.canvases.forEach((rawCanvas, index) => {
      if (!isRecord(rawCanvas)) {
        issues.push(`Canvas #${index + 1} is not an object.`);
        return;
      }
      const id = readId(rawCanvas.id, `Canvas #${index + 1}`, issues, canvasIds);
      if (!id) return;
      const projectId =
        typeof rawCanvas.projectId === 'string' ? rawCanvas.projectId : '';
      if (!projectId || !projectIdSet.has(projectId)) {
        issues.push(`Canvas #${index + 1} refers to a project that is not in the backup.`);
        return;
      }
      const name = asString(rawCanvas.name, `Canvas #${index + 1} name`, issues, {
        max: LIMITS.canvasName,
        trim: true,
      });
      if (!name) return;
      canvases.push({
        id,
        projectId,
        name,
        viewport: readViewport(rawCanvas.viewport),
        createdAt: readTimestamp(rawCanvas.createdAt, `Canvas "${name}" created date`, issues),
        updatedAt: readTimestamp(rawCanvas.updatedAt, `Canvas "${name}" updated date`, issues),
      });
    });
  }

  const completeCanvases = ensureBackupCanvases(projects, canvases, rawProjects);
  const canvasesByProject = new Map<string, Canvas[]>();
  for (const canvas of completeCanvases) {
    const list = canvasesByProject.get(canvas.projectId) ?? [];
    list.push(canvas);
    canvasesByProject.set(canvas.projectId, list);
  }
  for (const list of canvasesByProject.values()) {
    list.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  }
  const canvasById = new Map(completeCanvases.map((canvas) => [canvas.id, canvas]));

  const noteIds = new Set<string>();
  const notes: Note[] = [];

  data.notes.forEach((rawNote, index) => {
    if (!isRecord(rawNote)) {
      issues.push(`Note #${index + 1} is not an object.`);
      return;
    }
    const id = readId(rawNote.id, `Note #${index + 1}`, issues, noteIds);
    if (!id) return;
    const projectId =
      typeof rawNote.projectId === 'string' ? rawNote.projectId : '';
    if (!projectId || !projectIdSet.has(projectId)) {
      issues.push(`Note #${index + 1} refers to a project that is not in the backup.`);
      return;
    }
    let canvasId =
      typeof rawNote.canvasId === 'string' ? rawNote.canvasId : '';
    const referencedCanvas = canvasId ? canvasById.get(canvasId) : undefined;
    if (!referencedCanvas || referencedCanvas.projectId !== projectId) {
      canvasId = canvasesByProject.get(projectId)?.[0]?.id ?? '';
    }
    const title =
      rawNote.title == null
        ? ''
        : asString(rawNote.title, `Note #${index + 1} title`, issues, {
            max: LIMITS.noteTitle,
            allowEmpty: true,
          });
    const content =
      rawNote.content == null
        ? ''
        : asString(rawNote.content, `Note #${index + 1} content`, issues, {
            max: LIMITS.noteContent,
            allowEmpty: true,
          });
    const contentHtml =
      schemaVersion < 2
        ? markdownToHtml(content)
        : typeof rawNote.contentHtml === 'string'
          ? sanitizeNoteHtml(
              asString(rawNote.contentHtml, `Note #${index + 1} rich content`, issues, {
                max: LIMITS.noteContent,
                allowEmpty: true,
              }),
            )
          : markdownToHtml(content);
    const contentText =
      typeof rawNote.contentText === 'string'
        ? asString(rawNote.contentText, `Note #${index + 1} text`, issues, {
            max: LIMITS.noteContent,
            allowEmpty: true,
          })
        : textFromHtml(contentHtml) || content;

    notes.push({
      id,
      projectId,
      canvasId,
      title,
      kind: rawNote.kind === 'image' ? 'image' : 'note',
      content,
      contentHtml,
      contentText,
      layout: readLayout(rawNote.layout),
      ...(rawNote.browserCapture === true ? { browserCapture: true } : {}),
      ...(rawNote.hasUnseenUpdate === true ? { hasUnseenUpdate: true } : {}),
      createdAt: readTimestamp(rawNote.createdAt, `Note #${index + 1} created date`, issues),
      updatedAt: readTimestamp(rawNote.updatedAt, `Note #${index + 1} updated date`, issues),
    });
  });

  const noteById = new Map(notes.map((note) => [note.id, note]));
  const attachments: BackupAttachment[] = [];
  const attachmentIds = new Set<string>();
  if (data.attachments != null && !Array.isArray(data.attachments)) {
    issues.push('The backup attachments list is invalid.');
  } else if (Array.isArray(data.attachments)) {
    data.attachments.forEach((rawAttachment, index) => {
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
      const note = noteById.get(noteId);
      if (!id || !note) {
        issues.push(`Attachment #${index + 1} refers to a note that is not in the backup.`);
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
      } else if (dataBase64.length > 48 * 1024 * 1024) {
        issues.push(`Attachment #${index + 1} is too large to import.`);
      }
      attachments.push({
        id,
        noteId,
        projectId: note.projectId,
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

  let settings: AppSettings;
  if (data.settings != null && !isRecord(data.settings)) {
    issues.push('Settings must be an object.');
    settings = normalizeSettings(null);
  } else {
    settings = normalizeSettings(
      (data.settings as Partial<AppSettings> | undefined) ?? undefined,
    );
  }

  if (issues.length > 0) {
    throw new BackupValidationError(issues);
  }

  return {
    exportedAt,
    appVersion,
    schemaVersion: SCHEMA_VERSION,
    data: { projects, canvases: completeCanvases, notes, settings },
    attachments,
  };
}

export function parseBackupJson(text: string): ValidatedBackup {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new BackupValidationError([
      'The selected file is not valid JSON. Choose a backup created by ClipCanvas.',
    ]);
  }
  return validateBackup(parsed);
}

export async function readBackupFile(file: File): Promise<ValidatedBackup> {
  if (file.size > MAX_BACKUP_BYTES) {
    throw new BackupValidationError([
      `This file is larger than the ${Math.round(MAX_BACKUP_BYTES / 1024 / 1024)} MB import limit.`,
    ]);
  }
  let text: string;
  try {
    text = await file.text();
  } catch {
    throw new BackupValidationError(['The selected file could not be read.']);
  }
  return parseBackupJson(text);
}

export function analyzeImport(
  imported: NotebookDataset,
  current: NotebookDataset,
): ImportAnalysis {
  const existingProjectIds = new Set(current.projects.map((project) => project.id));
  const existingCanvasIds = new Set(current.canvases.map((canvas) => canvas.id));
  const existingNoteIds = new Set(current.notes.map((note) => note.id));

  return {
    projects: imported.projects.length,
    canvases: imported.canvases.length,
    notes: imported.notes.length,
    projectIdConflicts: imported.projects.filter((project) => existingProjectIds.has(project.id))
      .length,
    canvasIdConflicts: imported.canvases.filter((canvas) => existingCanvasIds.has(canvas.id))
      .length,
    noteIdConflicts: imported.notes.filter((note) => existingNoteIds.has(note.id)).length,
  };
}
