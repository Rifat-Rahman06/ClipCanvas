import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import {
  AlertCircle,
  Check,
  ChevronDown,
  FilePlus2,
  Files,
  FolderPlus,
  Layers,
  Loader2,
  LockKeyhole,
  Search,
  Save,
} from 'lucide-react';
import type { Canvas, Note } from '../types';
import {
  classNames,
  countWords,
  formatShortDate,
  normalizeCapturedText,
  noteDisplayTitle,
  textFromMarkdown,
  titleFromSelection,
  truncate,
} from '../lib/utils';
import { appendHtml, markdownToHtml, textFromHtml } from '../lib/richText';
import { capturedTextToHtml } from '../lib/insertion';
import { LIMITS, sortCanvases } from '../services/db/repository';
import {
  clearCapturePopup,
  readCapturePopup,
} from '../services/capture/popupCapture';
import { useNotebook } from '../state/NotebookContext';
import { Button } from '../components/Button';

type CaptureState =
  | { status: 'loading' }
  | { status: 'ready'; text: string }
  | { status: 'notice'; message: string }
  | { status: 'missing'; message: string };

type SaveMode = 'new' | 'existing';

interface CanvasTargetProps {
  canvases: Canvas[];
  noteCounts: Map<string, number>;
  selectedCanvasId: string | null;
  newCanvasName: string;
  disabled: boolean;
  onSelectExisting: (canvasId: string) => void;
  onSelectNew: (name: string) => void;
}

function CanvasTarget({
  canvases,
  noteCounts,
  selectedCanvasId,
  newCanvasName,
  disabled,
  onSelectExisting,
  onSelectNew,
}: CanvasTargetProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const selected = canvases.find((canvas) => canvas.id === selectedCanvasId) ?? null;

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => searchRef.current?.focus(), 30);
    const handlePointer = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', handlePointer);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('pointerdown', handlePointer);
    };
  }, [open]);

  const normalizedQuery = query.trim().toLocaleLowerCase('en-US');
  const filtered = canvases
    .filter((canvas) => {
      if (!normalizedQuery) return true;
      return canvas.name.toLocaleLowerCase('en-US').includes(normalizedQuery);
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  const exactMatch = canvases.find(
    (canvas) => canvas.name.trim().toLocaleLowerCase('en-US') === normalizedQuery,
  );
  const canCreate = normalizedQuery.length > 0 && !exactMatch;

  const chooseExisting = (canvasId: string) => {
    onSelectExisting(canvasId);
    setOpen(false);
    setQuery('');
  };

  const chooseNew = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const existing = canvases.find(
      (canvas) => canvas.name.trim().toLocaleLowerCase('en-US') === trimmed.toLocaleLowerCase('en-US'),
    );
    if (existing) chooseExisting(existing.id);
    else {
      onSelectNew(trimmed);
      setOpen(false);
      setQuery('');
    }
  };

  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      return;
    }
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (exactMatch) {
      chooseExisting(exactMatch.id);
    } else if (filtered.length === 1) {
      chooseExisting(filtered[0].id);
    } else if (filtered.length === 0 && canCreate) {
      chooseNew(query);
    }
  };

  const triggerLabel = selected
    ? selected.name
    : newCanvasName
      ? `${newCanvasName} · new canvas`
      : 'Choose or create a canvas';

  return (
    <div className="popup-target" ref={containerRef}>
      <button
        type="button"
        className={classNames('popup-target-trigger', open && 'is-open')}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="popup-target-icon">
          {selected ? <Layers size={16} /> : <FolderPlus size={16} />}
        </span>
        <span
          className={classNames(
            'popup-target-value',
            !selected && !newCanvasName && 'is-placeholder',
          )}
        >
          {triggerLabel}
        </span>
        {selected ? (
          <span className="popup-target-count">{noteCounts.get(selected.id) ?? 0}</span>
        ) : null}
        <ChevronDown size={15} className={classNames('popup-target-chevron', open && 'is-open')} />
      </button>

      {open ? (
        <div className="popup-target-panel">
          <div className="popup-target-search">
            <Search size={14} aria-hidden="true" />
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(event) => {
                const value = event.target.value;
                setQuery(value);
                // If the typed name already exists, select it immediately so
                // saving never creates a duplicate by accident.
                const match = canvases.find(
                  (canvas) =>
                    canvas.name.trim().toLocaleLowerCase('en-US') ===
                    value.trim().toLocaleLowerCase('en-US'),
                );
                if (match) onSelectExisting(match.id);
              }}
              onKeyDown={handleSearchKeyDown}
              placeholder="Find a canvas or type a new name…"
              aria-label="Find or create a canvas"
              maxLength={LIMITS.canvasName}
            />
          </div>
          <div className="popup-target-list" role="listbox" aria-label="Canvases">
            {filtered.length === 0 ? (
              <p className="popup-target-empty">
                {canvases.length === 0
                  ? 'No canvases yet. Type a name below, then choose Create canvas.'
                  : 'No canvas matches that name.'}
              </p>
            ) : (
              filtered.map((canvas) => {
                const active = canvas.id === selectedCanvasId;
                return (
                  <button
                    key={canvas.id}
                    type="button"
                    role="option"
                    aria-selected={active}
                    className={classNames('popup-target-option', active && 'is-active')}
                    onClick={() => chooseExisting(canvas.id)}
                  >
                    <Layers size={15} aria-hidden="true" />
                    <span className="popup-target-option-copy">
                      <span className="popup-target-option-name">{canvas.name}</span>
                      <span className="popup-target-option-meta">
                        {noteCounts.get(canvas.id) ?? 0}{' '}
                        {(noteCounts.get(canvas.id) ?? 0) === 1 ? 'element' : 'elements'}
                      </span>
                    </span>
                    {active ? <Check size={14} /> : null}
                  </button>
                );
              })
            )}
          </div>
          {canCreate ? (
            <button
              type="button"
              className="popup-target-create"
              onClick={() => chooseNew(query)}
            >
              <FolderPlus size={15} aria-hidden="true" />
              <span>
                Create canvas <strong>“{truncate(query.trim(), 42)}”</strong>
              </span>
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

interface NotebookPickerProps {
  notes: Note[];
  value: string | null;
  onChange: (noteId: string) => void;
  disabled: boolean;
}

function NotebookPicker({ notes, value, onChange, disabled }: NotebookPickerProps) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('en-US');
    return notes.filter((note) => {
      if (!normalized) return true;
      return `${note.title} ${note.contentText ?? note.content}`
        .toLocaleLowerCase('en-US')
        .includes(normalized);
    });
  }, [notes, query]);

  if (notes.length === 0) {
    return (
      <div className="popup-notebook-empty">
        <Files size={17} aria-hidden="true" />
        <span>No elements in this canvas yet. Choose “Create New Element” instead.</span>
      </div>
    );
  }

  return (
    <div className="popup-notebooks">
      <div className="popup-notebook-search">
        <Search size={14} aria-hidden="true" />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') event.stopPropagation();
          }}
          placeholder="Search elements…"
          aria-label="Search elements"
          disabled={disabled}
        />
      </div>
      <div className="popup-notebook-list" role="listbox" aria-label="Existing elements">
        {filtered.length === 0 ? (
          <p className="popup-target-empty">No element matches that search.</p>
        ) : (
          filtered.map((note) => {
            const active = note.id === value;
            const snippet = truncate(note.contentText || textFromMarkdown(note.content), 96);
            return (
              <button
                key={note.id}
                type="button"
                role="option"
                aria-selected={active}
                className={classNames('popup-notebook-option', active && 'is-active')}
                onClick={() => onChange(note.id)}
                disabled={disabled}
              >
                <span className="popup-notebook-option-main">
                  <span className="popup-notebook-option-title">{noteDisplayTitle(note)}</span>
                  {snippet ? (
                    <span className="popup-notebook-option-snippet">{snippet}</span>
                  ) : null}
                </span>
                <span className="popup-notebook-option-side">
                  {active ? <Check size={14} aria-hidden="true" /> : null}
                  <span>{formatShortDate(note.updatedAt)}</span>
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

function appendAtEnd(existing: string, addition: string): string {
  const left = existing.replace(/\s+$/u, '');
  const right = addition.replace(/^\n+/u, '');
  if (!left) return right;
  if (!right) return left;
  return `${left}\n\n${right}`;
}

export function PopupApp() {
  const notebook = useNotebook();
  const { data, loading, loadError, retryLoad } = notebook;
  const [capture, setCapture] = useState<CaptureState>({ status: 'loading' });
  const [text, setText] = useState('');
  const [selectedCanvasId, setSelectedCanvasId] = useState<string | null>(null);
  const [newCanvasName, setNewCanvasName] = useState('');
  const [mode, setMode] = useState<SaveMode>('existing');
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const id = new URLSearchParams(window.location.search).get('id');
    if (!id) {
      setCapture({
        status: 'missing',
        message: 'This selection is no longer available. Select the text again from the page.',
      });
      return () => {
        cancelled = true;
      };
    }

    void readCapturePopup(id).then((payload) => {
      if (cancelled) return;
      if (!payload) {
        setCapture({
          status: 'missing',
          message:
            'This selection has expired or was already saved. Select the text again from the page.',
        });
        return;
      }
      if (typeof payload.text === 'string') {
        const captured = normalizeCapturedText(payload.text);
        setCapture({ status: 'ready', text: captured });
        setText(captured);
      } else {
        setCapture({
          status: 'notice',
          message: payload.notice ?? 'ClipCanvas could not read that selection.',
        });
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  // The side panel is canvas-first, so the capture popup targets the same
  // canvases by name instead of the internal projects that the UI never shows.
  const canvases = useMemo(() => sortCanvases(data?.canvases ?? []), [data]);
  const notes = data?.notes ?? [];
  const noteCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const note of notes) map.set(note.canvasId, (map.get(note.canvasId) ?? 0) + 1);
    return map;
  }, [notes]);

  const canvasNotes = useMemo(() => {
    if (!selectedCanvasId) return [];
    return notes
      .filter((note) => note.canvasId === selectedCanvasId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.title.localeCompare(b.title));
  }, [notes, selectedCanvasId]);

  useEffect(() => {
    if (selectedCanvasId || newCanvasName) return;
    if (canvases.length === 0) return;
    const recent = [...canvases].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    setSelectedCanvasId(recent[0]?.id ?? null);
  }, [canvases, newCanvasName, selectedCanvasId]);

  useEffect(() => {
    if (!selectedCanvasId) return;
    if (!canvases.some((canvas) => canvas.id === selectedCanvasId)) {
      setSelectedCanvasId(null);
    }
  }, [canvases, selectedCanvasId]);

  useEffect(() => {
    // Wait for the database before deciding that a canvas has no elements;
    // otherwise the existing-element default would flip to "new" while loading.
    if (loading || !data || mode !== 'existing') return;
    if (!selectedCanvasId && !newCanvasName.trim()) {
      // Let the recent-canvas effect make its selection first when canvases
      // exist. With no canvases at all, there is nothing to append to.
      if (canvases.length > 0) return;
      setMode('new');
      setSelectedNoteId(null);
      return;
    }
    if (canvasNotes.length === 0) {
      setMode('new');
      setSelectedNoteId(null);
      return;
    }
    if (canvasNotes.some((note) => note.id === selectedNoteId)) return;
    setSelectedNoteId(canvasNotes[0]?.id ?? null);
  }, [canvasNotes, canvases, data, loading, mode, newCanvasName, selectedCanvasId, selectedNoteId]);

  const wordCount = countWords(text);
  const selectedNote = canvasNotes.find((note) => note.id === selectedNoteId) ?? null;
  const selectedCanvas = canvases.find((canvas) => canvas.id === selectedCanvasId) ?? null;
  const canChooseExisting = canvasNotes.length > 0 && !newCanvasName;
  const canSave =
    capture.status === 'ready' &&
    text.trim().length > 0 &&
    (selectedCanvasId !== null || newCanvasName.trim().length > 0) &&
    (mode === 'new' || Boolean(selectedNote));

  const close = async () => {
    if (savingRef.current) return;
    await clearCapturePopup();
    window.close();
  };

  const handleSelectExistingCanvas = (canvasId: string) => {
    setSelectedCanvasId(canvasId);
    setNewCanvasName('');
    setError(null);
  };

  const handleSelectNewCanvas = (name: string) => {
    setNewCanvasName(name);
    setSelectedCanvasId(null);
    setSelectedNoteId(null);
    setMode('new');
    setError(null);
  };

  const handleSave = async () => {
    if (savingRef.current) return;
    const captured = normalizeCapturedText(text);
    if (!captured.trim()) {
      setError('Add some text before saving.');
      return;
    }
    if (!selectedCanvasId && !newCanvasName.trim()) {
      setError('Choose a canvas, or type a new canvas name.');
      return;
    }
    if (mode === 'existing' && !selectedNote) {
      setError('Choose the element you want to add this selection to.');
      return;
    }
    if (mode === 'existing' && newCanvasName) {
      setError('A new canvas has no elements yet. Create a new element instead.');
      return;
    }

    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      if (mode === 'existing' && selectedNote) {
        const existingHtml =
          selectedNote.contentHtml ?? markdownToHtml(selectedNote.content);
        const additionHtml = capturedTextToHtml(captured);
        const contentHtml = appendHtml(existingHtml, additionHtml);
        const contentText = textFromHtml(contentHtml);
        // The captured selection is already Markdown, so append it to the
        // canonical source instead of flattening it into plain text.
        const content = appendAtEnd(selectedNote.content ?? '', captured);
        await notebook.updateNote(selectedNote.id, {
          content,
          contentHtml,
          contentText,
          // This is the only workflow that marks an existing note as updated.
          // The capture also supersedes the New indicator if it was still set.
          browserCapture: false,
          hasUnseenUpdate: true,
        });
      } else {
        const noteHtml = capturedTextToHtml(captured);
        const input = {
          title: titleFromSelection(textFromMarkdown(captured)),
          content: captured,
          contentHtml: noteHtml,
          contentText: textFromHtml(noteHtml),
          // Only brand-new elements from the capture popup get the canvas
          // indicator. Appending to an existing note updates that element.
          browserCapture: true,
        };
        if (newCanvasName.trim()) {
          const canvas = await notebook.createCanvas({ name: newCanvasName.trim() });
          await notebook.createNote({
            ...input,
            projectId: canvas.projectId,
            canvasId: canvas.id,
          });
        } else if (selectedCanvas) {
          await notebook.createNote({
            ...input,
            projectId: selectedCanvas.projectId,
            canvasId: selectedCanvas.id,
          });
        } else {
          throw new Error('Choose a canvas for this element.');
        }
      }

      await clearCapturePopup();
      savingRef.current = false;
      setSaving(false);
      window.close();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : 'The selection could not be saved. Please try again.',
      );
      savingRef.current = false;
      setSaving(false);
    }
  };

  const handlePopupKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && !event.defaultPrevented && !savingRef.current) {
      event.preventDefault();
      void close();
    }
  };

  if (capture.status === 'loading' || loading) {
    return (
      <div className="capture-popup capture-popup-state">
        <div className="popup-state-card" role="status" aria-live="polite">
          <Loader2 size={22} className="spin" aria-hidden="true" />
          <h1>Preparing your selection…</h1>
          <p>ClipCanvas is opening your local notebook.</p>
        </div>
      </div>
    );
  }

  if (loadError || !data) {
    return (
      <div className="capture-popup capture-popup-state">
        <div className="popup-state-card" role="alert">
          <AlertCircle size={22} aria-hidden="true" />
          <h1>Your notebook could not be opened</h1>
          <p>{loadError ?? 'The local notebook database is unavailable.'}</p>
          <div className="popup-state-actions">
            <Button variant="secondary" onClick={retryLoad}>
              Try again
            </Button>
            <Button variant="primary" onClick={() => void close()}>
              Close
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (capture.status === 'notice' || capture.status === 'missing') {
    return (
      <div className="capture-popup capture-popup-state">
        <div className="popup-state-card" role="alert">
          <AlertCircle size={22} aria-hidden="true" />
          <h1>{capture.status === 'notice' ? 'Nothing was saved' : 'Selection unavailable'}</h1>
          <p>{capture.message}</p>
          <div className="popup-state-actions">
            <Button variant="primary" onClick={() => void close()}>
              Close
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="capture-popup" onKeyDown={handlePopupKeyDown}>
      <div className="popup-scroll">
        <section className="popup-section">
          <div className="popup-section-head">
            <span className="field-label">Selected text</span>
            <span className="popup-meta">
              {wordCount.toLocaleString()} {wordCount === 1 ? 'word' : 'words'}
            </span>
          </div>
          <textarea
            className="textarea popup-textarea"
            value={text}
            maxLength={LIMITS.noteContent}
            aria-label="Selected text"
            autoFocus
            disabled={saving}
            onChange={(event) => {
              setText(event.target.value);
              if (error) setError(null);
            }}
          />
        </section>

        <section className="popup-section">
          <div className="popup-section-head">
            <span className="field-label">Canvas</span>
            {newCanvasName ? <span className="popup-badge">New</span> : null}
          </div>
          <CanvasTarget
            canvases={canvases}
            noteCounts={noteCounts}
            selectedCanvasId={selectedCanvasId}
            newCanvasName={newCanvasName}
            disabled={saving}
            onSelectExisting={handleSelectExistingCanvas}
            onSelectNew={handleSelectNewCanvas}
          />
        </section>

        <section className="popup-section">
          <span className="field-label">Save as</span>
          <div className="popup-modes" role="radiogroup" aria-label="Save destination">
            <button
              type="button"
              role="radio"
              aria-checked={mode === 'new'}
              className={classNames('popup-mode', mode === 'new' && 'is-active')}
              disabled={saving}
              onClick={() => {
                setMode('new');
                setError(null);
              }}
            >
              <span className="popup-mode-icon">
                <FilePlus2 size={17} aria-hidden="true" />
              </span>
              <span className="popup-mode-copy">
                <span className="popup-mode-title">Create New Element</span>
              </span>
              <span className="popup-mode-check">
                {mode === 'new' ? <Check size={14} aria-hidden="true" /> : null}
              </span>
            </button>

            <button
              type="button"
              role="radio"
              aria-checked={mode === 'existing'}
              className={classNames('popup-mode', mode === 'existing' && 'is-active')}
              disabled={saving || !canChooseExisting}
              onClick={() => {
                setMode('existing');
                setError(null);
              }}
            >
              <span className="popup-mode-icon">
                <Files size={17} aria-hidden="true" />
              </span>
              <span className="popup-mode-copy">
                <span className="popup-mode-title">Add to Existing Element</span>
              </span>
              <span className="popup-mode-check">
                {mode === 'existing' ? <Check size={14} aria-hidden="true" /> : null}
              </span>
            </button>
          </div>

          {mode === 'existing' ? (
            <NotebookPicker
              notes={canvasNotes}
              value={selectedNoteId}
              onChange={(noteId) => {
                setSelectedNoteId(noteId);
                setError(null);
              }}
              disabled={saving}
            />
          ) : null}
        </section>

        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>

      <footer className="popup-footer">
        <span className="popup-privacy">
          <LockKeyhole size={12} aria-hidden="true" />
          Saved only on this device
        </span>
        <div className="popup-footer-actions">
          <button
            type="button"
            className="btn btn-secondary btn-md"
            onClick={() => void close()}
            disabled={saving}
          >
            Cancel
          </button>
          <Button
            variant="primary"
            onClick={() => void handleSave()}
            loading={saving}
            disabled={!canSave}
            icon={saving ? undefined : <Save size={15} />}
          >
            {mode === 'existing' ? 'Add to Existing Element' : 'Create New Element'}
          </Button>
        </div>
      </footer>
    </div>
  );
}
