import { useEffect, useState } from 'react';
import { FolderInput, Layers } from 'lucide-react';
import type { Canvas, Note } from '../types';
import { noteDisplayTitle } from '../lib/utils';
import { sortCanvases } from '../services/db/repository';
import { useNotebook } from '../state/NotebookContext';
import { useToast } from '../state/ToastContext';
import { Button } from './Button';
import { Dialog } from './Dialog';

interface MoveNoteDialogProps {
  open: boolean;
  note: Note | null;
  canvases: Canvas[];
  noteCounts: Map<string, number>;
  onClose: () => void;
  onMoved: (note: Note) => void;
  onCreateCanvas: () => void;
}

export function MoveNoteDialog({
  open,
  note,
  canvases,
  noteCounts,
  onClose,
  onMoved,
  onCreateCanvas,
}: MoveNoteDialogProps) {
  const { updateNote } = useNotebook();
  const { notify } = useToast();
  const [targetCanvasId, setTargetCanvasId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !note) return;
    setTargetCanvasId(note.canvasId);
    setError(null);
    setSaving(false);
  }, [open, note]);

  if (!note) return null;

  const sortedCanvases = sortCanvases(canvases);
  const otherCanvases = sortedCanvases.filter((canvas) => canvas.id !== note.canvasId);
  const targetCanvas = sortedCanvases.find((canvas) => canvas.id === targetCanvasId);

  const handleMove = async () => {
    if (!targetCanvas || targetCanvas.id === note.canvasId || saving) return;
    setSaving(true);
    setError(null);
    try {
      const moved = await updateNote(note.id, {
        canvasId: targetCanvas.id,
        projectId: targetCanvas.projectId,
      });
      notify({
        kind: 'success',
        message: `Moved to “${targetCanvas.name}”.`,
      });
      onMoved(moved);
      onClose();
    } catch (moveError) {
      setError(moveError instanceof Error ? moveError.message : 'The note could not be moved.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      title="Move note"
      description={`Choose a canvas for “${noteDisplayTitle(note)}”.`}
      onClose={saving ? () => undefined : onClose}
      busy={saving}
      size="sm"
      footer={
        <>
          <button type="button" className="btn btn-secondary btn-md" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <Button
            variant="primary"
            icon={<FolderInput size={15} />}
            loading={saving}
            disabled={!targetCanvas || targetCanvas.id === note.canvasId}
            onClick={() => void handleMove()}
          >
            Move note
          </Button>
        </>
      }
    >
      <div className="form-stack">
        <div className="field-group">
          <label className="field-label" htmlFor="move-note-canvas">
            Destination canvas
          </label>
          <div className="select-wrap">
            <Layers size={14} className="select-icon" aria-hidden="true" />
            <select
              id="move-note-canvas"
              className="select"
              value={targetCanvasId ?? ''}
              disabled={saving}
              onChange={(event) => setTargetCanvasId(event.target.value || null)}
            >
              {sortedCanvases.map((canvas) => (
                <option key={canvas.id} value={canvas.id}>
                  {canvas.name} · {noteCounts.get(canvas.id) ?? 0}{' '}
                  {(noteCounts.get(canvas.id) ?? 0) === 1 ? 'item' : 'items'}
                </option>
              ))}
            </select>
          </div>
        </div>
        {otherCanvases.length === 0 ? (
          <div className="inline-notice">
            <p>This is the only canvas. Create another canvas before moving the note.</p>
            <button
              type="button"
              className="text-button"
              onClick={() => {
                onClose();
                onCreateCanvas();
              }}
            >
              Create a canvas
            </button>
          </div>
        ) : (
          <p className="field-help">
            The note keeps its content and timestamps.
          </p>
        )}
        {targetCanvas ? (
          <p className="move-summary">
            Move to <strong>{targetCanvas.name}</strong>
          </p>
        ) : null}
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
