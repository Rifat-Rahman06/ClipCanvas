import {
  deleteDB,
  openDB,
  type DBSchema,
  type IDBPDatabase,
  type IDBPTransaction,
  type StoreNames,
} from 'idb';
import type {
  AppSettings,
  AttachmentRecord,
  Canvas,
  CanvasViewport,
  Note,
  Project,
} from '../../types';
import { CANVAS_MAX_ZOOM, CANVAS_MIN_ZOOM, SCHEMA_VERSION } from '../../types';
import { createId } from '../../lib/utils';
import { markdownToHtml, textFromHtml } from '../../lib/richText';
import { defaultSettings } from './settings';

export const DB_NAME = 'clipcanvas-notebook';
// Existing installations keep using the original database name so a rebrand
// never hides previously saved notebooks.
const LEGACY_DB_NAME = 'folio-notebook';
export const DB_VERSION = 5;
export const SETTINGS_KEY = 'app';
export const DEFAULT_CANVAS_NAME = 'Main canvas';

export interface ClipCanvasDB extends DBSchema {
  projects: {
    key: string;
    value: Project;
    indexes: {
      'by-updated': string;
    };
  };
  canvases: {
    key: string;
    value: Canvas;
    indexes: {
      'by-project': string;
      'by-updated': string;
    };
  };
  notes: {
    key: string;
    value: Note;
    indexes: {
      'by-project': string;
      'by-canvas': string;
      'by-updated': string;
    };
  };
  settings: {
    key: string;
    value: AppSettings;
  };
  attachments: {
    key: string;
    value: AttachmentRecord;
    indexes: {
      'by-note': string;
      'by-project': string;
    };
  };
}

let dbPromise: Promise<IDBPDatabase<ClipCanvasDB>> | null = null;

export class DatabaseError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'DatabaseError';
  }
}

/**
 * Database versioning lives here. Each future version gets its own guarded
 * block so existing installations migrate in place rather than losing data.
 */
function upgradeDatabase(
  db: IDBPDatabase<ClipCanvasDB>,
  oldVersion: number,
  _newVersion: number,
  transaction: IDBPTransaction<ClipCanvasDB, ArrayLike<StoreNames<ClipCanvasDB>>, 'versionchange'>,
): void {
  if (oldVersion < 1) {
    const projects = db.createObjectStore('projects', { keyPath: 'id' });
    projects.createIndex('by-updated', 'updatedAt');

    const notes = db.createObjectStore('notes', { keyPath: 'id' });
    notes.createIndex('by-project', 'projectId');
    notes.createIndex('by-canvas', 'canvasId');
    notes.createIndex('by-updated', 'updatedAt');

    db.createObjectStore('settings');
    transaction.objectStore('settings').put(defaultSettings(), SETTINGS_KEY);
  }

  if (oldVersion < 2) {
    const attachments = db.createObjectStore('attachments', { keyPath: 'id' });
    attachments.createIndex('by-note', 'noteId');
    attachments.createIndex('by-project', 'projectId');
  }

  if (oldVersion < 4) {
    if (!db.objectStoreNames.contains('canvases')) {
      const canvases = db.createObjectStore('canvases', { keyPath: 'id' });
      canvases.createIndex('by-project', 'projectId');
      canvases.createIndex('by-updated', 'updatedAt');
    }
    const notes = transaction.objectStore('notes');
    if (!notes.indexNames.contains('by-canvas')) {
      notes.createIndex('by-canvas', 'canvasId');
    }
    // Tags are no longer part of the notebook model.
    const legacyDb = db as unknown as {
      objectStoreNames: DOMStringList;
      deleteObjectStore(name: string): void;
    };
    if (legacyDb.objectStoreNames.contains('tags')) {
      legacyDb.deleteObjectStore('tags');
    }
  }

  if (oldVersion < 5) {
    // The pre-migration backup feature has been removed. Delete its obsolete
    // store for existing installations; fresh databases never create it.
    const legacyDb = db as unknown as {
      objectStoreNames: DOMStringList;
      deleteObjectStore(name: string): void;
    };
    if (legacyDb.objectStoreNames.contains('migrationBackups')) {
      legacyDb.deleteObjectStore('migrationBackups');
    }
  }
}

function defaultLayout(index: number) {
  return {
    x: 48 + (index % 3) * 478,
    y: 72 + Math.floor(index / 3) * 388,
    width: 430,
    height: 340,
    zIndex: index + 1,
  };
}

function cleanViewport(viewport: CanvasViewport | undefined): CanvasViewport {
  const finite = (value: unknown, fallback: number) =>
    typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return {
    x: finite(viewport?.x, 0),
    y: finite(viewport?.y, 0),
    zoom: Math.min(
      CANVAS_MAX_ZOOM,
      Math.max(CANVAS_MIN_ZOOM, finite(viewport?.zoom, 1)),
    ),
  };
}

/**
 * Fills fields introduced after schema version 1 and creates the default canvas
 * for every project. This runs after the database is open, so it can use normal
 * promises without keeping a version-change transaction alive. It is idempotent
 * and skips records that already have the new fields.
 */
async function migrateLegacyData(db: IDBPDatabase<ClipCanvasDB>): Promise<void> {
  const tx = db.transaction(
    ['projects', 'canvases', 'notes'],
    'readwrite',
  );
  const projectStore = tx.objectStore('projects');
  const canvasStore = tx.objectStore('canvases');
  const noteStore = tx.objectStore('notes');
  const [projects, canvases, notes] = await Promise.all([
    projectStore.getAll(),
    canvasStore.getAll(),
    noteStore.getAll(),
  ]);

  const canvasesByProject = new Map<string, Canvas[]>();
  for (const canvas of canvases) {
    const list = canvasesByProject.get(canvas.projectId) ?? [];
    list.push(canvas);
    canvasesByProject.set(canvas.projectId, list);
  }
  for (const list of canvasesByProject.values()) {
    list.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  }

  for (const project of projects) {
    let projectCanvases = canvasesByProject.get(project.id);
    if (!projectCanvases || projectCanvases.length === 0) {
      const timestamp = project.createdAt ?? new Date().toISOString();
      const legacy = project as Project & { canvas?: CanvasViewport };
      const canvas: Canvas = {
        id: createId(),
        projectId: project.id,
        name: DEFAULT_CANVAS_NAME,
        viewport: cleanViewport(legacy.canvas),
        createdAt: timestamp,
        updatedAt: project.updatedAt ?? timestamp,
      };
      await canvasStore.put(canvas);
      projectCanvases = [canvas];
      canvasesByProject.set(project.id, projectCanvases);
    }
  }

  const notesByProject = new Map<string, Note[]>();
  for (const note of notes) {
    const group = notesByProject.get(note.projectId) ?? [];
    group.push(note);
    notesByProject.set(note.projectId, group);
  }

  for (const [projectId, group] of notesByProject) {
    const projectCanvases = canvasesByProject.get(projectId) ?? [];
    const validCanvasIds = new Set(projectCanvases.map((canvas) => canvas.id));
    const fallbackCanvasId = projectCanvases[0]?.id ?? '';
    group.sort(
      (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
    );
    for (const [index, note] of group.entries()) {
      const contentHtml = note.contentHtml ?? markdownToHtml(note.content ?? '');
      const contentText = note.contentText ?? (textFromHtml(contentHtml) || note.content || '');
      const layout = note.layout ?? defaultLayout(index);
      const canvasId =
        note.canvasId && validCanvasIds.has(note.canvasId)
          ? note.canvasId
          : fallbackCanvasId;
      if (
        contentHtml !== note.contentHtml ||
        contentText !== note.contentText ||
        !note.layout ||
        canvasId !== note.canvasId
      ) {
        await noteStore.put({
          ...note,
          canvasId,
          contentHtml,
          contentText,
          layout,
        });
      }
    }
  }

  await tx.done;
}

async function resolveDatabaseName(): Promise<string> {
  try {
    if (typeof indexedDB.databases !== 'function') return DB_NAME;
    const databases = await indexedDB.databases();
    const names = new Set(databases.map((database) => database.name));
    if (names.has(DB_NAME)) return DB_NAME;
    if (names.has(LEGACY_DB_NAME)) return LEGACY_DB_NAME;
  } catch {
    // Fall through to the current database name.
  }
  return DB_NAME;
}

export function getDb(): Promise<IDBPDatabase<ClipCanvasDB>> {
  if (!dbPromise) {
    dbPromise = resolveDatabaseName()
      .then((databaseName) =>
        openDB<ClipCanvasDB>(databaseName, DB_VERSION, {
          upgrade: upgradeDatabase,
          blocked() {
            console.warn('ClipCanvas database upgrade is blocked by another open tab.');
          },
        }),
      )
      .then(async (db) => {
        await migrateLegacyData(db);
        return db;
      })
      .catch((error: unknown) => {
        dbPromise = null;
        throw new DatabaseError(
          'ClipCanvas could not open its local notebook database. Try reloading the extension. Your existing data has not been changed.',
          { cause: error },
        );
      });
  }
  return dbPromise;
}

export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (navigator.storage?.persist) {
      return await navigator.storage.persist();
    }
  } catch {
    // Persistence is a best-effort hint; IndexedDB still works without it.
  }
  return false;
}

export async function resetDatabaseForTests(): Promise<void> {
  if (dbPromise) {
    const db = await dbPromise.catch(() => null);
    db?.close();
  }
  dbPromise = null;
  await deleteDB(DB_NAME);
  await deleteDB(LEGACY_DB_NAME);
}

export async function closeDatabaseForTests(): Promise<void> {
  if (dbPromise) {
    const db = await dbPromise.catch(() => null);
    db?.close();
  }
  dbPromise = null;
}

export function currentSchemaVersion(): number {
  return SCHEMA_VERSION;
}
