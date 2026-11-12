export const APP_NAME = 'ClipCanvas';
export const APP_VERSION = '1.0.0';
export const SCHEMA_VERSION = 3;
export const BACKUP_FORMAT = 'clipcanvas-research-notebook';
export const LEGACY_BACKUP_FORMAT = 'folio-research-notebook';
export const EDITOR_FONT_SIZE_MIN = 13;
export const EDITOR_FONT_SIZE_MAX = 22;
export const EDITOR_FONT_SIZE_DEFAULT = 16;
export const SINGLE_CLICK_ZOOM_MIN = 0.5;
export const SINGLE_CLICK_ZOOM_MAX = 2.5;
export const SINGLE_CLICK_ZOOM_DEFAULT = 1;
export const DEFAULT_NOTE_WIDTH_MIN = 280;
export const DEFAULT_NOTE_WIDTH_MAX = 1200;
export const DEFAULT_NOTE_WIDTH_DEFAULT = 430;
/** How long typing in a note waits before its edit is persisted. */
export const AUTOSAVE_DELAY_SECONDS_MIN = 0.5;
export const AUTOSAVE_DELAY_SECONDS_MAX = 60;
export const AUTOSAVE_DELAY_SECONDS_STEP = 0.5;
export const AUTOSAVE_DELAY_SECONDS_DEFAULT = 1;
/** The canvas is unbounded, so allow it to zoom far out for spread-out content. */
export const CANVAS_MIN_ZOOM = 0.005;
export const CANVAS_MAX_ZOOM = 2.5;
export const TOUCHPAD_ZOOM_SENSITIVITY_MIN = 1;
export const TOUCHPAD_ZOOM_SENSITIVITY_MAX = 10;
export const TOUCHPAD_ZOOM_SENSITIVITY_STEP = 0.5;
export const TOUCHPAD_ZOOM_SENSITIVITY_DEFAULT = 1;

export type EditorMode = 'write' | 'preview';
export type ImportMode = 'merge' | 'replace';

export interface CanvasViewport {
  x: number;
  y: number;
  zoom: number;
}

export interface NoteLayout {
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  /** Set once the element has been manually resized, so its height persists. */
  heightLocked?: boolean;
  /** Set once the element's width has been manually resized. */
  widthLocked?: boolean;
}

/** A named canvas inside a project. Tabs, viewports, and nodes belong to a canvas. */
export interface Canvas {
  id: string;
  projectId: string;
  name: string;
  viewport: CanvasViewport;
  createdAt: string;
  updatedAt: string;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
}

export type NoteKind = 'note' | 'image';

export interface Note {
  id: string;
  projectId: string;
  canvasId: string;
  title: string;
  /** Canvas images share note storage but hide note chrome until selected. */
  kind?: NoteKind;
  /** Legacy Markdown/plain-text fallback kept for migration and portability. */
  content: string;
  /** Rich editor HTML. */
  contentHtml?: string;
  /** Plain text used by search, snippets, and title fallback. */
  contentText?: string;
  /** Position and size on the canvas. */
  layout?: NoteLayout;
  /**
   * Marks a note created from a browser text selection that has not been
   * opened yet. The canvas shows a small "New" badge until the note is opened.
   */
  browserCapture?: boolean;
  /** Marks content changed since the note was last opened for editing. */
  hasUnseenUpdate?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Attachment {
  id: string;
  noteId: string;
  projectId: string;
  mimeType: string;
  width: number;
  height: number;
  byteSize: number;
  createdAt: string;
}

export interface AttachmentRecord extends Attachment {
  blob: Blob;
}

export interface BackupAttachment extends Attachment {
  /** Base64 image bytes. Images are only base64-encoded inside backup files. */
  dataBase64: string;
}

export interface AppSettings {
  schemaVersion: number;
  lastBackupAt: string | null;
  lastImportAt: string | null;
  editorMode: EditorMode;
  editorFontSize: number;
  /** Seconds of inactivity before an edited note is saved. */
  autosaveDelaySeconds: number;
  /**
   * Multiplier applied to the window-aware zoom used when an element is opened
   * with a single click. 1 is the automatic fit.
   */
  singleClickZoom: number;
  /** Multiplier for pinch-to-zoom gestures on the canvas, from 1x to 10x. */
  touchpadZoomSensitivity: number;
  /** Width used by newly created, not-yet-resized elements. */
  defaultNoteWidth: number;
  sidebarCollapsed: boolean;
}

export interface NotebookDataset {
  projects: Project[];
  canvases: Canvas[];
  notes: Note[];
  settings: AppSettings;
}

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  schemaVersion: number;
  exportedAt: string;
  appVersion: string;
  data: {
    projects: Project[];
    canvases: Canvas[];
    notes: Note[];
    settings: AppSettings;
    attachments?: BackupAttachment[];
  };
}

export interface ValidatedBackup {
  exportedAt: string;
  appVersion: string;
  schemaVersion: number;
  data: NotebookDataset;
  attachments: BackupAttachment[];
}

export interface ImportAnalysis {
  projects: number;
  canvases: number;
  notes: number;
  projectIdConflicts: number;
  canvasIdConflicts: number;
  noteIdConflicts: number;
}

export interface ImportResult {
  mode: ImportMode;
  projectsAdded: number;
  canvasesAdded: number;
  notesAdded: number;
  projectIdsRemapped: number;
  canvasIdsRemapped: number;
  noteIdsRemapped: number;
  replacedProjects: number;
  replacedCanvases: number;
  replacedNotes: number;
}

export interface ProjectInput {
  name: string;
  description?: string;
}

export interface CanvasInput {
  /** Optional because canvases can be created without a visible project layer. */
  projectId?: string;
  name: string;
}

export interface NoteInput {
  projectId: string;
  canvasId?: string;
  title?: string;
  kind?: NoteKind;
  content?: string;
  contentHtml?: string;
  contentText?: string;
  layout?: NoteLayout;
  browserCapture?: boolean;
  hasUnseenUpdate?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface NotePatch {
  projectId?: string;
  canvasId?: string;
  title?: string;
  content?: string;
  contentHtml?: string;
  contentText?: string;
  layout?: NoteLayout;
  browserCapture?: boolean;
  hasUnseenUpdate?: boolean;
}

export interface UpdateNoteOptions {
  /**
   * Autosave persists the note while the editor is active, but publishing the
   * new note to React state during typing forces the canvas node tree to
   * reconcile and can invalidate ProseMirror's DOM selection. Persist-only
   * saves defer that state update until editing ends.
   */
  publish?: boolean;
}

export type CaptureNoticeCode =
  | 'empty-selection'
  | 'restricted-page'
  | 'injection-blocked'
  | 'no-active-tab'
  | 'unknown-error';

export type CaptureOutcome =
  | {
      status: 'ready';
      text: string;
    }
  | {
      status: 'notice';
      code: CaptureNoticeCode;
      message: string;
    };

export interface WorkspaceState {
  openCanvasIds: string[];
  activeCanvasId: string | null;
  activeProjectId: string | null;
  activeNoteId: string | null;
}

/** A captured passage waiting to be inserted into an open note. */
export interface NoteInsertion {
  noteId: string;
  text: string;
  nonce: number;
}

export interface SearchFilters {
  projectId: string | null;
}

export interface NoteSearchResult {
  note: Note;
  project: Project;
  score: number;
  snippet: string;
  snippetField: 'content' | 'title' | 'project';
  matchedFields: Array<'title' | 'content' | 'project'>;
}

export interface ProjectSearchResult {
  project: Project;
  score: number;
  snippet: string;
  matchedFields: Array<'name' | 'description'>;
}

export interface SearchResults {
  query: string;
  notes: NoteSearchResult[];
  projects: ProjectSearchResult[];
  totalNotes: number;
  totalProjects: number;
}
