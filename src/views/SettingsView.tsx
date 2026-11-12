import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarClock,
  Database,
  Download,
  FileJson,
  HardDrive,
  LockKeyhole,
  PencilLine,
  ShieldCheck,
  Upload,
  X,
} from 'lucide-react';
import type {
  ImportAnalysis,
  ImportResult,
  ValidatedBackup,
} from '../types';
import {
  APP_VERSION,
  AUTOSAVE_DELAY_SECONDS_DEFAULT,
  AUTOSAVE_DELAY_SECONDS_MAX,
  AUTOSAVE_DELAY_SECONDS_MIN,
  AUTOSAVE_DELAY_SECONDS_STEP,
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
} from '../types';
import { formatBytes, formatDateTime, nowIso } from '../lib/utils';
import {
  BackupValidationError,
  analyzeImport,
  createBackupWithAttachments,
  readBackupFile,
  serializeBackup,
} from '../services/import-export/backup';
import { backupFilename, downloadJson } from '../services/import-export/download';
import { useNotebook } from '../state/NotebookContext';
import { useToast } from '../state/ToastContext';
import { Button } from '../components/Button';
import { IconButton } from '../components/Button';
import { SettingsSection } from '../components/SettingsSection';
import { ImportDialog } from './ImportDialog';

interface SettingsViewProps {
  onClose: () => void;
  onImported: (result: ImportResult) => void;
}

interface StorageEstimate {
  usage: number;
  quota: number;
}

const TOUCHPAD_ZOOM_SENSITIVITY_VALUES = Array.from(
  {
    length:
      Math.round(
        (TOUCHPAD_ZOOM_SENSITIVITY_MAX - TOUCHPAD_ZOOM_SENSITIVITY_MIN) /
          TOUCHPAD_ZOOM_SENSITIVITY_STEP,
      ) + 1,
  },
  (_, index) => TOUCHPAD_ZOOM_SENSITIVITY_MIN + index * TOUCHPAD_ZOOM_SENSITIVITY_STEP,
);

function formatZoomSensitivity(value: number): string {
  return `${value.toFixed(1).replace(/\.0$/, '')}x`;
}

export function SettingsView({ onClose, onImported }: SettingsViewProps) {
  const { data, updateSettings } = useNotebook();
  const { notify } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [exporting, setExporting] = useState(false);
  const [readingImport, setReadingImport] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [pendingImport, setPendingImport] = useState<{
    backup: ValidatedBackup;
    analysis: ImportAnalysis;
  } | null>(null);
  const [estimate, setEstimate] = useState<StorageEstimate | null>(null);
  const [fontSize, setFontSize] = useState(EDITOR_FONT_SIZE_DEFAULT);
  const fontDraftRef = useRef(EDITOR_FONT_SIZE_DEFAULT);
  const fontDirtyRef = useRef(false);
  const savedFontSize = data?.settings.editorFontSize;
  const [autosaveDelay, setAutosaveDelay] = useState(AUTOSAVE_DELAY_SECONDS_DEFAULT);
  const autosaveDraftRef = useRef(AUTOSAVE_DELAY_SECONDS_DEFAULT);
  const autosaveDirtyRef = useRef(false);
  const savedAutosaveDelay = data?.settings.autosaveDelaySeconds;
  const [singleClickZoom, setSingleClickZoom] = useState(SINGLE_CLICK_ZOOM_DEFAULT);
  const zoomDraftRef = useRef(SINGLE_CLICK_ZOOM_DEFAULT);
  const zoomDirtyRef = useRef(false);
  const savedSingleClickZoom = data?.settings.singleClickZoom;
  const [touchpadZoomSensitivity, setTouchpadZoomSensitivity] = useState(
    TOUCHPAD_ZOOM_SENSITIVITY_DEFAULT,
  );
  const touchpadZoomDraftRef = useRef(TOUCHPAD_ZOOM_SENSITIVITY_DEFAULT);
  const touchpadZoomDirtyRef = useRef(false);
  const savedTouchpadZoomSensitivity = data?.settings.touchpadZoomSensitivity;
  const [defaultNoteWidth, setDefaultNoteWidth] = useState(DEFAULT_NOTE_WIDTH_DEFAULT);
  const widthDraftRef = useRef(DEFAULT_NOTE_WIDTH_DEFAULT);
  const widthDirtyRef = useRef(false);
  const savedDefaultNoteWidth = data?.settings.defaultNoteWidth;

  useEffect(() => {
    if (savedFontSize === undefined || fontDirtyRef.current) return;
    fontDraftRef.current = savedFontSize;
    setFontSize(savedFontSize);
  }, [savedFontSize]);

  useEffect(() => {
    if (savedFontSize === undefined || fontSize === savedFontSize) return;
    const timer = window.setTimeout(() => {
      void updateSettings({ editorFontSize: fontSize })
        .then(() => {
          if (fontDraftRef.current === fontSize) fontDirtyRef.current = false;
        })
        .catch((error) => {
          if (fontDraftRef.current === fontSize) {
            fontDirtyRef.current = false;
            fontDraftRef.current = savedFontSize;
            setFontSize(savedFontSize);
          }
          notify({
            kind: 'error',
            message:
              error instanceof Error ? error.message : 'The text size could not be saved.',
          });
        });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [fontSize, notify, savedFontSize, updateSettings]);

  useEffect(() => {
    if (savedAutosaveDelay === undefined || autosaveDirtyRef.current) return;
    autosaveDraftRef.current = savedAutosaveDelay;
    setAutosaveDelay(savedAutosaveDelay);
  }, [savedAutosaveDelay]);

  useEffect(() => {
    if (savedAutosaveDelay === undefined || autosaveDelay === savedAutosaveDelay) return;
    const timer = window.setTimeout(() => {
      void updateSettings({ autosaveDelaySeconds: autosaveDelay })
        .then((settings) => {
          if (autosaveDraftRef.current === autosaveDelay) {
            autosaveDirtyRef.current = false;
            autosaveDraftRef.current = settings.autosaveDelaySeconds;
            setAutosaveDelay(settings.autosaveDelaySeconds);
          }
        })
        .catch((error) => {
          if (autosaveDraftRef.current === autosaveDelay) {
            autosaveDirtyRef.current = false;
            autosaveDraftRef.current = savedAutosaveDelay;
            setAutosaveDelay(savedAutosaveDelay);
          }
          notify({
            kind: 'error',
            message:
              error instanceof Error
                ? error.message
                : 'The autosave delay could not be saved.',
          });
        });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [autosaveDelay, notify, savedAutosaveDelay, updateSettings]);

  useEffect(() => {
    if (savedSingleClickZoom === undefined || zoomDirtyRef.current) return;
    zoomDraftRef.current = savedSingleClickZoom;
    setSingleClickZoom(savedSingleClickZoom);
  }, [savedSingleClickZoom]);

  useEffect(() => {
    if (savedSingleClickZoom === undefined || singleClickZoom === savedSingleClickZoom) return;
    const timer = window.setTimeout(() => {
      void updateSettings({ singleClickZoom })
        .then(() => {
          if (zoomDraftRef.current === singleClickZoom) zoomDirtyRef.current = false;
        })
        .catch((error) => {
          if (zoomDraftRef.current === singleClickZoom) {
            zoomDirtyRef.current = false;
            zoomDraftRef.current = savedSingleClickZoom;
            setSingleClickZoom(savedSingleClickZoom);
          }
          notify({
            kind: 'error',
            message:
              error instanceof Error ? error.message : 'The zoom setting could not be saved.',
          });
        });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [notify, savedSingleClickZoom, singleClickZoom, updateSettings]);

  useEffect(() => {
    if (savedTouchpadZoomSensitivity === undefined || touchpadZoomDirtyRef.current) return;
    touchpadZoomDraftRef.current = savedTouchpadZoomSensitivity;
    setTouchpadZoomSensitivity(savedTouchpadZoomSensitivity);
  }, [savedTouchpadZoomSensitivity]);

  useEffect(() => {
    if (
      savedTouchpadZoomSensitivity === undefined ||
      touchpadZoomSensitivity === savedTouchpadZoomSensitivity
    ) {
      return;
    }
    const timer = window.setTimeout(() => {
      void updateSettings({ touchpadZoomSensitivity })
        .then(() => {
          if (touchpadZoomDraftRef.current === touchpadZoomSensitivity) {
            touchpadZoomDirtyRef.current = false;
          }
        })
        .catch((error) => {
          if (touchpadZoomDraftRef.current === touchpadZoomSensitivity) {
            touchpadZoomDirtyRef.current = false;
            touchpadZoomDraftRef.current = savedTouchpadZoomSensitivity;
            setTouchpadZoomSensitivity(savedTouchpadZoomSensitivity);
          }
          notify({
            kind: 'error',
            message:
              error instanceof Error
                ? error.message
                : 'The touchpad zoom setting could not be saved.',
          });
        });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [
    notify,
    savedTouchpadZoomSensitivity,
    touchpadZoomSensitivity,
    updateSettings,
  ]);

  useEffect(() => {
    if (savedDefaultNoteWidth === undefined || widthDirtyRef.current) return;
    widthDraftRef.current = savedDefaultNoteWidth;
    setDefaultNoteWidth(savedDefaultNoteWidth);
  }, [savedDefaultNoteWidth]);

  useEffect(() => {
    if (savedDefaultNoteWidth === undefined || defaultNoteWidth === savedDefaultNoteWidth) {
      return;
    }
    const timer = window.setTimeout(() => {
      void updateSettings({ defaultNoteWidth })
        .then(() => {
          if (widthDraftRef.current === defaultNoteWidth) widthDirtyRef.current = false;
        })
        .catch((error) => {
          if (widthDraftRef.current === defaultNoteWidth) {
            widthDirtyRef.current = false;
            widthDraftRef.current = savedDefaultNoteWidth;
            setDefaultNoteWidth(savedDefaultNoteWidth);
          }
          notify({
            kind: 'error',
            message:
              error instanceof Error
                ? error.message
                : 'The default element width could not be saved.',
          });
        });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [defaultNoteWidth, notify, savedDefaultNoteWidth, updateSettings]);

  useEffect(() => {
    let cancelled = false;
    if (navigator.storage?.estimate) {
      void navigator.storage.estimate().then((result) => {
        if (cancelled) return;
        setEstimate({ usage: result.usage ?? 0, quota: result.quota ?? 0 });
      }).catch(() => undefined);
    }
    return () => {
      cancelled = true;
    };
  }, [data]);

  const notebookBytes = useMemo(() => {
    if (!data) return 0;
    return new TextEncoder().encode(
      JSON.stringify({ notes: data.notes, projects: data.projects, canvases: data.canvases }),
    ).byteLength;
  }, [data]);

  if (!data) return null;

  const handleExport = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const timestamp = nowIso();
      const settings = await updateSettings({ lastBackupAt: timestamp });
      const backup = await createBackupWithAttachments({ ...data, settings }, timestamp);
      const filename = backupFilename(new Date(timestamp));
      await downloadJson(filename, serializeBackup(backup));
      notify({
        kind: 'success',
        message: `Backup downloaded as ${filename}.`,
      });
    } catch (error) {
      notify({
        kind: 'error',
        message: error instanceof Error ? error.message : 'The backup could not be exported.',
      });
    } finally {
      setExporting(false);
    }
  };

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setReadingImport(true);
    setImportError(null);
    try {
      const backup = await readBackupFile(file);
      const analysis = analyzeImport(backup.data, data);
      setPendingImport({ backup, analysis });
    } catch (error) {
      if (error instanceof BackupValidationError) {
        setImportError(error.message.replace(/^This backup could not be imported:\s*/, ''));
      } else {
        setImportError(
          error instanceof Error
            ? error.message
            : 'The selected file could not be read as a ClipCanvas backup.',
        );
      }
    } finally {
      setReadingImport(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleImported = (result: ImportResult) => {
    setPendingImport(null);
    onImported(result);
  };

  const handleFontSizeChange = (value: number) => {
    fontDraftRef.current = value;
    fontDirtyRef.current = true;
    setFontSize(value);
  };

  const handleAutosaveDelayChange = (value: number) => {
    if (!Number.isFinite(value)) return;
    autosaveDraftRef.current = value;
    autosaveDirtyRef.current = true;
    setAutosaveDelay(value);
  };

  const handleSingleClickZoomChange = (value: number) => {
    zoomDraftRef.current = value;
    zoomDirtyRef.current = true;
    setSingleClickZoom(value);
  };

  const handleTouchpadZoomSensitivityChange = (value: number) => {
    touchpadZoomDraftRef.current = value;
    touchpadZoomDirtyRef.current = true;
    setTouchpadZoomSensitivity(value);
  };

  const handleDefaultNoteWidthChange = (value: number) => {
    widthDraftRef.current = value;
    widthDirtyRef.current = true;
    setDefaultNoteWidth(value);
  };

  return (
    <div className="view-page settings-view">
      <header className="view-header">
        <div>
          <span className="eyebrow">Notebook control room</span>
          <h1>Settings &amp; data</h1>
        </div>
        <IconButton label="Close settings" onClick={onClose}>
          <X size={17} />
        </IconButton>
      </header>

      <div className="settings-content">
        <SettingsSection
          icon={Database}
          title="Your notebook"
          description="Everything stays inside this Chrome profile until you export a backup."
        >
          <div className="settings-stats">
            <div className="settings-stat">
              <strong>{data.canvases.length}</strong>
              <span>Canvases</span>
            </div>
            <div className="settings-stat">
              <strong>{data.notes.length}</strong>
              <span>Elements</span>
            </div>
            <div className="settings-stat">
              <strong>{data.notes.filter((note) => note.kind === 'image').length}</strong>
              <span>Images</span>
            </div>
          </div>
          <div className="storage-meter">
            <div className="storage-meter-head">
              <span>
                <HardDrive size={13} aria-hidden="true" />
                Notebook content
              </span>
              <strong>{formatBytes(notebookBytes)}</strong>
            </div>
            {estimate && estimate.quota > 0 ? (
              <>
                <div className="storage-bar" aria-hidden="true">
                  <span
                    className="storage-bar-fill"
                    style={{
                      width: `${Math.max(1, Math.min(100, (estimate.usage / estimate.quota) * 100))}%`,
                    }}
                  />
                </div>
                <span className="storage-note">
                  {formatBytes(estimate.usage)} used of {formatBytes(estimate.quota)} available to
                  this extension.
                </span>
              </>
            ) : (
              <span className="storage-note">
                Stored locally in IndexedDB. Chrome keeps extension data on this device.
              </span>
            )}
          </div>
          <div className="settings-timestamps">
            <span>
              <CalendarClock size={12} />
              Last backup: {data.settings.lastBackupAt ? formatDateTime(data.settings.lastBackupAt) : 'never'}
            </span>
            <span>
              <Upload size={12} />
              Last import: {data.settings.lastImportAt ? formatDateTime(data.settings.lastImportAt) : 'never'}
            </span>
          </div>
        </SettingsSection>

        <SettingsSection
          icon={FileJson}
          title="Backup & portability"
          description="Export every canvas, note, image, and timestamp as readable JSON."
        >
          <div className="settings-actions">
            <Button
              variant="primary"
              icon={<Download size={15} />}
              loading={exporting}
              onClick={() => void handleExport()}
            >
              Export data
            </Button>
            <Button
              variant="secondary"
              icon={<Upload size={15} />}
              loading={readingImport}
              onClick={() => fileInputRef.current?.click()}
            >
              Import data
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              className="sr-only"
              onChange={(event) => void handleFile(event.target.files?.[0])}
            />
          </div>
          <div className="settings-info-box">
            <ShieldCheck size={16} aria-hidden="true" />
            <div>
              <strong>Your data never leaves this browser unless you export it.</strong>
              <p>
                Import a backup with <em>Merge</em> to add it safely, or <em>Replace</em> to restore
                a clean snapshot. Replace always attempts a safety backup first.
              </p>
            </div>
          </div>
          {importError ? (
            <div className="import-error settings-import-error" role="alert">
              <FileJson size={15} aria-hidden="true" />
              <div>
                <strong>That backup could not be imported.</strong>
                <p className="import-error-detail">{importError}</p>
                <button type="button" className="text-button" onClick={() => setImportError(null)}>
                  Dismiss
                </button>
              </div>
            </div>
          ) : null}
        </SettingsSection>

        <SettingsSection
          icon={PencilLine}
          title="Editor"
          description="Defaults for canvas elements."
        >
          <div className="settings-field-row settings-font-size-row">
            <div>
              <span className="settings-field-title">Text size</span>
              <span className="settings-field-description">
                Changes writing and preview text only.
              </span>
            </div>
            <div className="font-size-control">
              <span className="font-size-sample font-size-sample-small" aria-hidden="true">
                A
              </span>
              <input
                id="editor-font-size"
                type="range"
                min={EDITOR_FONT_SIZE_MIN}
                max={EDITOR_FONT_SIZE_MAX}
                step={1}
                value={fontSize}
                aria-label="Editor text size"
                aria-valuetext={`${fontSize} pixels`}
                onChange={(event) => handleFontSizeChange(Number(event.target.value))}
              />
              <span className="font-size-sample font-size-sample-large" aria-hidden="true">
                A
              </span>
              <output className="font-size-value" htmlFor="editor-font-size">
                {fontSize}px
              </output>
            </div>
          </div>
          <div className="settings-field-row settings-zoom-row">
            <div>
              <span className="settings-field-title">Autosave delay</span>
              <span className="settings-field-description">
                How long ClipCanvas waits after you stop typing before saving an element.
              </span>
            </div>
            <div className="settings-number-control">
              <input
                id="autosave-delay"
                type="number"
                min={AUTOSAVE_DELAY_SECONDS_MIN}
                max={AUTOSAVE_DELAY_SECONDS_MAX}
                step={AUTOSAVE_DELAY_SECONDS_STEP}
                value={autosaveDelay}
                aria-label="Autosave delay in seconds"
                onChange={(event) => handleAutosaveDelayChange(event.target.valueAsNumber)}
              />
              <span aria-hidden="true">seconds</span>
            </div>
          </div>
          <div className="settings-field-row settings-zoom-row">
            <div>
              <span className="settings-field-title">Single-click zoom strength</span>
              <span className="settings-field-description">
                Scales the automatic zoom used when an element is opened. 100% is the
                recommended fit for the current window.
              </span>
            </div>
            <div className="font-size-control">
              <input
                id="single-click-zoom"
                type="range"
                min={Math.round(SINGLE_CLICK_ZOOM_MIN * 100)}
                max={Math.round(SINGLE_CLICK_ZOOM_MAX * 100)}
                step={5}
                value={Math.round(singleClickZoom * 100)}
                aria-label="Single-click zoom strength"
                aria-valuetext={`${Math.round(singleClickZoom * 100)} percent`}
                onChange={(event) =>
                  handleSingleClickZoomChange(Number(event.target.value) / 100)
                }
              />
              <output className="font-size-value" htmlFor="single-click-zoom">
                {Math.round(singleClickZoom * 100)}%
              </output>
            </div>
          </div>
          <div className="settings-field-row settings-zoom-row">
            <div>
              <span className="settings-field-title">Touchpad zoom sensitivity</span>
              <span className="settings-field-description">
                Scales pinch-to-zoom gestures inside ClipCanvas only. Choose any value from 1x to
                10x in 0.5x steps.
              </span>
            </div>
            <div className="font-size-control">
              <input
                id="touchpad-zoom-sensitivity"
                type="range"
                list="touchpad-zoom-sensitivity-steps"
                min={TOUCHPAD_ZOOM_SENSITIVITY_MIN}
                max={TOUCHPAD_ZOOM_SENSITIVITY_MAX}
                step={TOUCHPAD_ZOOM_SENSITIVITY_STEP}
                value={touchpadZoomSensitivity}
                aria-label="Touchpad zoom sensitivity"
                aria-valuetext={`${formatZoomSensitivity(touchpadZoomSensitivity)} sensitivity`}
                onChange={(event) =>
                  handleTouchpadZoomSensitivityChange(Number(event.target.value))
                }
              />
              <datalist id="touchpad-zoom-sensitivity-steps">
                {TOUCHPAD_ZOOM_SENSITIVITY_VALUES.map((value) => (
                  <option key={value} value={value} />
                ))}
              </datalist>
              <output className="font-size-value" htmlFor="touchpad-zoom-sensitivity">
                {formatZoomSensitivity(touchpadZoomSensitivity)}
              </output>
            </div>
          </div>
          <div className="settings-field-row settings-zoom-row">
            <div>
              <span className="settings-field-title">Default element width</span>
              <span className="settings-field-description">
                New elements use this width. Resized elements keep their own width.
              </span>
            </div>
            <div className="font-size-control">
              <input
                id="default-note-width"
                type="range"
                min={DEFAULT_NOTE_WIDTH_MIN}
                max={DEFAULT_NOTE_WIDTH_MAX}
                step={10}
                value={defaultNoteWidth}
                aria-label="Default element width"
                aria-valuetext={`${defaultNoteWidth} pixels`}
                onChange={(event) =>
                  handleDefaultNoteWidthChange(Number(event.target.value))
                }
              />
              <output className="font-size-value" htmlFor="default-note-width">
                {defaultNoteWidth}px
              </output>
            </div>
          </div>
        </SettingsSection>

        <SettingsSection
          icon={LockKeyhole}
          title="About ClipCanvas"
          description="A local-first research notebook built for Chrome's side panel."
        >
          <div className="about-grid">
            <span>Version</span>
            <strong>{APP_VERSION}</strong>
            <span>Data schema</span>
            <strong>v{SCHEMA_VERSION}</strong>
            <span>Storage</span>
            <strong>IndexedDB · local device</strong>
            <span>Network access</span>
            <strong>None</strong>
          </div>
          <p className="about-note">
            ClipCanvas asks only for permissions needed to capture selections, open the side panel, and
            download backups. Notebook content is never sent to a server.
          </p>
        </SettingsSection>
      </div>

      <ImportDialog
        open={Boolean(pendingImport)}
        backup={pendingImport?.backup ?? null}
        analysis={pendingImport?.analysis ?? null}
        current={data}
        onClose={() => setPendingImport(null)}
        onImported={(result) => handleImported(result)}
      />
    </div>
  );
}
