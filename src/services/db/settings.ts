import type { AppSettings, EditorMode } from '../../types';
import {
  AUTOSAVE_DELAY_SECONDS_DEFAULT,
  AUTOSAVE_DELAY_SECONDS_MAX,
  AUTOSAVE_DELAY_SECONDS_MIN,
  DEFAULT_NOTE_WIDTH_DEFAULT,
  DEFAULT_NOTE_WIDTH_MAX,
  DEFAULT_NOTE_WIDTH_MIN,
  EDITOR_FONT_SIZE_DEFAULT,
  EDITOR_FONT_SIZE_MAX,
  EDITOR_FONT_SIZE_MIN,
  SCHEMA_VERSION,
  SINGLE_CLICK_ZOOM_DEFAULT,
  SINGLE_CLICK_ZOOM_MAX,
  SINGLE_CLICK_ZOOM_MIN,
  TOUCHPAD_ZOOM_SENSITIVITY_DEFAULT,
  TOUCHPAD_ZOOM_SENSITIVITY_MAX,
  TOUCHPAD_ZOOM_SENSITIVITY_MIN,
  TOUCHPAD_ZOOM_SENSITIVITY_STEP,
} from '../../types';

function normalizeEditorFontSize(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return EDITOR_FONT_SIZE_DEFAULT;
  }
  return Math.min(EDITOR_FONT_SIZE_MAX, Math.max(EDITOR_FONT_SIZE_MIN, Math.round(value)));
}

function normalizeAutosaveDelaySeconds(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return AUTOSAVE_DELAY_SECONDS_DEFAULT;
  }
  const clamped = Math.min(
    AUTOSAVE_DELAY_SECONDS_MAX,
    Math.max(AUTOSAVE_DELAY_SECONDS_MIN, value),
  );
  return Math.round(clamped * 10) / 10;
}

function normalizeSingleClickZoom(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return SINGLE_CLICK_ZOOM_DEFAULT;
  }
  return Math.min(SINGLE_CLICK_ZOOM_MAX, Math.max(SINGLE_CLICK_ZOOM_MIN, value));
}

function normalizeTouchpadZoomSensitivity(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return TOUCHPAD_ZOOM_SENSITIVITY_DEFAULT;
  }
  const clamped = Math.min(
    TOUCHPAD_ZOOM_SENSITIVITY_MAX,
    Math.max(TOUCHPAD_ZOOM_SENSITIVITY_MIN, value),
  );
  const snapped =
    Math.round(clamped / TOUCHPAD_ZOOM_SENSITIVITY_STEP) *
    TOUCHPAD_ZOOM_SENSITIVITY_STEP;
  return Number(snapped.toFixed(2));
}

function normalizeDefaultNoteWidth(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_NOTE_WIDTH_DEFAULT;
  }
  return Math.min(
    DEFAULT_NOTE_WIDTH_MAX,
    Math.max(DEFAULT_NOTE_WIDTH_MIN, Math.round(value)),
  );
}

export function defaultSettings(): AppSettings {
  return {
    schemaVersion: SCHEMA_VERSION,
    lastBackupAt: null,
    lastImportAt: null,
    editorMode: 'write',
    editorFontSize: EDITOR_FONT_SIZE_DEFAULT,
    autosaveDelaySeconds: AUTOSAVE_DELAY_SECONDS_DEFAULT,
    singleClickZoom: SINGLE_CLICK_ZOOM_DEFAULT,
    touchpadZoomSensitivity: TOUCHPAD_ZOOM_SENSITIVITY_DEFAULT,
    defaultNoteWidth: DEFAULT_NOTE_WIDTH_DEFAULT,
    sidebarCollapsed: false,
  };
}

export function normalizeSettings(
  value: Partial<AppSettings> | null | undefined,
): AppSettings {
  const defaults = defaultSettings();
  if (!value || typeof value !== 'object') return defaults;

  const editorMode: EditorMode =
    value.editorMode === 'preview' || value.editorMode === 'write'
      ? value.editorMode
      : defaults.editorMode;

  return {
    schemaVersion: SCHEMA_VERSION,
    lastBackupAt:
      typeof value.lastBackupAt === 'string' && !Number.isNaN(Date.parse(value.lastBackupAt))
        ? new Date(value.lastBackupAt).toISOString()
        : null,
    lastImportAt:
      typeof value.lastImportAt === 'string' && !Number.isNaN(Date.parse(value.lastImportAt))
        ? new Date(value.lastImportAt).toISOString()
        : null,
    editorMode,
    editorFontSize: normalizeEditorFontSize(value.editorFontSize),
    autosaveDelaySeconds: normalizeAutosaveDelaySeconds(value.autosaveDelaySeconds),
    singleClickZoom: normalizeSingleClickZoom(value.singleClickZoom),
    touchpadZoomSensitivity: normalizeTouchpadZoomSensitivity(
      value.touchpadZoomSensitivity,
    ),
    defaultNoteWidth: normalizeDefaultNoteWidth(value.defaultNoteWidth),
    sidebarCollapsed: value.sidebarCollapsed === true,
  };
}
