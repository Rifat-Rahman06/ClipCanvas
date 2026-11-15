import { useEffect, useState, type FormEvent } from 'react';
import { Layers, Pencil } from 'lucide-react';
import type { Canvas } from '../types';
import { LIMITS } from '../services/db/repository';
import { useNotebook } from '../state/NotebookContext';
import { useToast } from '../state/ToastContext';
import { Button } from './Button';
import { Dialog } from './Dialog';

interface CanvasDialogProps {
  open: boolean;
  mode?: 'create' | 'rename';
  canvas?: Canvas | null;
  projectId: string | null;
  onClose: () => void;
  onSaved: (canvas: Canvas) => void;
}

export function CanvasDialog({
  open,
  mode = 'create',
  canvas = null,
  projectId,
  onClose,
  onSaved,
}: CanvasDialogProps) {
  const { createCanvas, updateCanvas } = useNotebook();
  const { notify } = useToast();
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const renaming = mode === 'rename';

  useEffect(() => {
    if (!open) return;
    setName(renaming ? canvas?.name ?? '' : '');
    setError(null);
    setSaving(false);
    // Only reset when the dialog opens or switches target; typing should not
    // be interrupted by a re-render that hands over a new canvas object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode, canvas?.id]);

  const handleSubmit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (saving) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Canvas name cannot be empty.');
      return;
    }
    if (renaming && !canvas) {
      setError('That canvas no longer exists.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const saved =
        renaming && canvas
          ? await updateCanvas(canvas.id, { name: trimmed })
          : await createCanvas({ projectId: projectId ?? undefined, name: trimmed });
      notify({
        kind: 'success',
        message: renaming
          ? `Canvas renamed to “${saved.name}”.`
          : `Canvas “${saved.name}” created.`,
      });
      onSaved(saved);
      onClose();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : renaming
            ? 'The canvas could not be renamed.'
            : 'The canvas could not be created.',
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      title={renaming ? 'Rename canvas' : 'New canvas'}
      description={
        renaming
          ? 'Choose a new name for this canvas. Its notes and images stay in place.'
          : 'Give this canvas a name. Its notes and images will stay together on this canvas.'
      }
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
            type="submit"
            form="canvas-form"
            loading={saving}
            icon={!saving ? renaming ? <Pencil size={15} /> : <Layers size={15} /> : undefined}
          >
            {renaming ? 'Rename canvas' : 'Create canvas'}
          </Button>
        </>
      }
    >
      <form id="canvas-form" className="form-stack" onSubmit={(event) => void handleSubmit(event)}>
        <div className="field-group">
          <label className="field-label" htmlFor="canvas-name">
            Canvas name
          </label>
          <input
            id="canvas-name"
            className="input"
            type="text"
            value={name}
            maxLength={LIMITS.canvasName}
            placeholder="e.g. Chapter 2 map"
            data-autofocus
            disabled={saving}
            onChange={(event) => {
              setName(event.target.value);
              if (error) setError(null);
            }}
          />
        </div>
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}
