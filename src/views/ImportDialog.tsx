import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownToLine,
  Check,
  GitMerge,
  HardDriveDownload,
  ShieldCheck,
} from 'lucide-react';
import type {
  ImportAnalysis,
  ImportMode,
  ImportResult,
  NotebookDataset,
  ValidatedBackup,
} from '../types';
import { classNames, formatDateTime } from '../lib/utils';
import {
  createBackupWithAttachments,
  serializeBackup,
} from '../services/import-export/backup';
import { commitImport } from '../services/import-export/commit';
import { downloadJson, preImportBackupFilename } from '../services/import-export/download';
import { useNotebook } from '../state/NotebookContext';
import { useToast } from '../state/ToastContext';
import { Button } from '../components/Button';
import { Dialog } from '../components/Dialog';

interface ImportDialogProps {
  open: boolean;
  backup: ValidatedBackup | null;
  analysis: ImportAnalysis | null;
  current: NotebookDataset;
  onClose: () => void;
  onImported: (result: ImportResult) => void;
}

export function ImportDialog({
  open,
  backup,
  analysis,
  current,
  onClose,
  onImported,
}: ImportDialogProps) {
  const { refresh } = useNotebook();
  const { notify } = useToast();
  const [mode, setMode] = useState<ImportMode>('merge');
  const [acknowledged, setAcknowledged] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setMode('merge');
    setAcknowledged(false);
    setImporting(false);
    setError(null);
  }, [open, backup]);

  if (!backup) return null;

  const counts = {
    projects: backup.data.projects.length,
    canvases: backup.data.canvases.length,
    notes: backup.data.notes.length,
  };
  const canImport = mode === 'merge' || acknowledged;

  const handleImport = async () => {
    if (importing || !canImport) return;
    setImporting(true);
    setError(null);
    try {
      if (mode === 'replace') {
        const safetyBackup = await createBackupWithAttachments(current);
        await downloadJson(
          preImportBackupFilename(),
          serializeBackup(safetyBackup),
        );
        notify({
          kind: 'info',
          message: 'A safety backup of your current notebook was downloaded first.',
        });
      }
      const result = await commitImport(backup, mode);
      await refresh();
      onImported(result);
      notify({
        kind: 'success',
        message:
          mode === 'replace'
            ? `Notebook replaced with ${result.projectsAdded} ${
                result.projectsAdded === 1 ? 'project' : 'projects'
              }, ${result.canvasesAdded} ${
                result.canvasesAdded === 1 ? 'canvas' : 'canvases'
              }, and ${result.notesAdded} ${result.notesAdded === 1 ? 'note' : 'notes'}.`
            : `Merged ${result.projectsAdded} ${
                result.projectsAdded === 1 ? 'project' : 'projects'
              }, ${result.canvasesAdded} ${
                result.canvasesAdded === 1 ? 'canvas' : 'canvases'
              }, and ${result.notesAdded} ${result.notesAdded === 1 ? 'note' : 'notes'} into your notebook.`,
      });
      onClose();
    } catch (importError) {
      setError(
        importError instanceof Error
          ? importError.message
          : 'The backup could not be imported. Your existing notebook is unchanged.',
      );
    } finally {
      setImporting(false);
    }
  };

  return (
    <Dialog
      open={open}
      title="Import backup"
      description="Choose how this backup should join your notebook. Nothing is changed until you confirm."
      onClose={importing ? () => undefined : onClose}
      busy={importing}
      size="md"
      footer={
        <>
          <button
            type="button"
            className="btn btn-secondary btn-md"
            onClick={onClose}
            disabled={importing}
            data-autofocus
          >
            Cancel
          </button>
          <Button
            variant={mode === 'replace' ? 'danger' : 'primary'}
            loading={importing}
            disabled={!canImport}
            icon={
              mode === 'replace' ? <HardDriveDownload size={15} /> : <GitMerge size={15} />
            }
            onClick={() => void handleImport()}
          >
            {importing
              ? 'Importing…'
              : mode === 'replace'
                ? 'Replace notebook'
                : 'Merge into notebook'}
          </Button>
        </>
      }
    >
      <div className="import-summary">
        <div className="import-summary-head">
          <span className="import-file-icon">
            <ArrowDownToLine size={18} />
          </span>
          <div>
            <strong>Research notebook backup</strong>
            <span>
              Exported {formatDateTime(backup.exportedAt)}
              {backup.appVersion !== 'unknown' ? ` · ClipCanvas ${backup.appVersion}` : ''}
            </span>
          </div>
        </div>
        <div className="import-counts">
          <div>
            <strong>{counts.projects}</strong>
            <span>{counts.projects === 1 ? 'project' : 'projects'}</span>
          </div>
          <div>
            <strong>{counts.canvases}</strong>
            <span>{counts.canvases === 1 ? 'canvas' : 'canvases'}</span>
          </div>
          <div>
            <strong>{counts.notes}</strong>
            <span>{counts.notes === 1 ? 'note' : 'notes'}</span>
          </div>
        </div>
      </div>

      <fieldset className="import-modes">
        <legend className="field-label">Import mode</legend>
        <label className={classNames('import-mode', mode === 'merge' && 'is-selected')}>
          <input
            type="radio"
            name="import-mode"
            value="merge"
            checked={mode === 'merge'}
            disabled={importing}
            onChange={() => setMode('merge')}
          />
          <span className="import-mode-radio" aria-hidden="true" />
          <span className="import-mode-copy">
            <span className="import-mode-title">
              <GitMerge size={15} />
              Merge with existing data
              <span className="badge badge-neutral">Recommended</span>
            </span>
            <span className="import-mode-description">
              Adds everything from the backup without overwriting your current notes. Projects,
              canvases, or notes whose IDs already exist are imported as copies with new IDs.
            </span>
            {analysis ? (
              <span className="import-mode-details">
                {analysis.projectIdConflicts > 0 ||
                analysis.canvasIdConflicts > 0 ||
                analysis.noteIdConflicts > 0
                  ? `${analysis.projectIdConflicts} project ID ${
                      analysis.projectIdConflicts === 1 ? 'conflict' : 'conflicts'
                    }, ${analysis.canvasIdConflicts} canvas ID ${
                      analysis.canvasIdConflicts === 1 ? 'conflict' : 'conflicts'
                    }, and ${analysis.noteIdConflicts} note ID ${
                      analysis.noteIdConflicts === 1 ? 'conflict' : 'conflicts'
                    } will be imported as copies.`
                  : 'No project, canvas, or note ID conflicts.'}
              </span>
            ) : null}
          </span>
        </label>

        <label className={classNames('import-mode', mode === 'replace' && 'is-selected is-danger')}>
          <input
            type="radio"
            name="import-mode"
            value="replace"
            checked={mode === 'replace'}
            disabled={importing}
            onChange={() => setMode('replace')}
          />
          <span className="import-mode-radio" aria-hidden="true" />
          <span className="import-mode-copy">
            <span className="import-mode-title">
              <HardDriveDownload size={15} />
              Replace all data
            </span>
            <span className="import-mode-description">
              Deletes the current notebook contents and restores only this backup. Your existing{' '}
              {current.projects.length}{' '}
              {current.projects.length === 1 ? 'project' : 'projects'} and{' '}
              {current.notes.length} {current.notes.length === 1 ? 'note' : 'notes'} will be
              removed.
            </span>
          </span>
        </label>
      </fieldset>

      {mode === 'replace' ? (
        <div className="import-warning">
          <AlertTriangle size={16} aria-hidden="true" />
          <div>
            <strong>Replace mode is destructive.</strong>
            <p>
              A safety backup of your current notebook will be downloaded before the replacement. If
              that backup fails, the import will stop. This action cannot be undone inside ClipCanvas.
            </p>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={acknowledged}
                disabled={importing}
                onChange={(event) => setAcknowledged(event.target.checked)}
              />
              <span>I understand that my current notebook will be replaced.</span>
            </label>
          </div>
        </div>
      ) : (
        <div className="import-assurance">
          <ShieldCheck size={16} aria-hidden="true" />
          <span>
            Your existing projects and notes stay untouched. The import is committed as one
            transaction, so a failure leaves the notebook exactly as it was.
          </span>
        </div>
      )}

      {error ? (
        <div className="import-error" role="alert">
          <AlertTriangle size={15} aria-hidden="true" />
          <span>{error}</span>
        </div>
      ) : null}

      {importing ? (
        <p className="import-progress" role="status">
          <Check size={14} />
          {mode === 'replace' ? 'Creating safety backup and restoring…' : 'Validating and merging…'}
        </p>
      ) : null}
    </Dialog>
  );
}
