import { useEffect, useState, type FormEvent } from 'react';
import { Layers } from 'lucide-react';
import type { Canvas } from '../types';
import { LIMITS } from '../services/db/repository';
import { useNotebook } from '../state/NotebookContext';
import { useToast } from '../state/ToastContext';
import { Button } from './Button';
import { Dialog } from './Dialog';

interface CanvasDialogProps {
  open: boolean;
  projectId: string | null;
  onClose: () => void;
  onSaved: (canvas: Canvas) => void;
}

export function CanvasDialog({ open, projectId, onClose, onSaved }: CanvasDialogProps) {
  const { createCanvas } = useNotebook();
  const { notify } = useToast();
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName('');
    setError(null);
    setSaving(false);
  }, [open]);

  const handleSubmit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (saving) return;
    if (!name.trim()) {
      setError('Canvas name cannot be empty.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const canvas = await createCanvas({ projectId: projectId ?? undefined, name });
      notify({ kind: 'success', message: `Canvas “${canvas.name}” created.` });
      onSaved(canvas);
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'The canvas could not be created.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      title="New canvas"
      description="Give this canvas a name. Its notes and images will stay together on this canvas."
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
            icon={!saving ? <Layers size={15} /> : undefined}
          >
            Create canvas
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
