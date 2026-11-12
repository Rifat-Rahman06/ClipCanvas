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
  FolderClosed,
  FolderPlus,
  Loader2,
  LockKeyhole,
  Search,
  Save,
} from 'lucide-react';
import type { Note, Project } from '../types';
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
import { appendHtml, markdownToHtml, plainTextToHtml, textFromHtml } from '../lib/richText';
import { LIMITS } from '../services/db/repository';
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

interface ProjectTargetProps {
  projects: Project[];
  noteCounts: Map<string, number>;
  selectedProjectId: string | null;
  newProjectName: string;
  disabled: boolean;
  onSelectExisting: (projectId: string) => void;
  onSelectNew: (name: string) => void;
}

function ProjectTarget({
  projects,
  noteCounts,
  selectedProjectId,
  newProjectName,
  disabled,
  onSelectExisting,
  onSelectNew,
}: ProjectTargetProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const selected = projects.find((project) => project.id === selectedProjectId) ?? null;

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
  const filtered = projects
    .filter((project) => {
      if (!normalizedQuery) return true;
      return `${project.name} ${project.description}`
        .toLocaleLowerCase('en-US')
        .includes(normalizedQuery);
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  const exactMatch = projects.find(
    (project) => project.name.trim().toLocaleLowerCase('en-US') === normalizedQuery,
  );
  const canCreate = normalizedQuery.length > 0 && !exactMatch;

  const chooseExisting = (projectId: string) => {
    onSelectExisting(projectId);
    setOpen(false);
    setQuery('');
  };

  const chooseNew = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const existing = projects.find(
      (project) => project.name.trim().toLocaleLowerCase('en-US') === trimmed.toLocaleLowerCase('en-US'),
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
    : newProjectName
      ? `${newProjectName} · new project`
      : 'Choose or create a project';

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
          {selected ? <FolderClosed size={16} /> : <FolderPlus size={16} />}
        </span>
        <span
          className={classNames(
            'popup-target-value',
            !selected && !newProjectName && 'is-placeholder',
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
                const match = projects.find(
                  (project) =>
                    project.name.trim().toLocaleLowerCase('en-US') ===
                    value.trim().toLocaleLowerCase('en-US'),
                );
                if (match) onSelectExisting(match.id);
              }}
              onKeyDown={handleSearchKeyDown}
              placeholder="Find a project or type a new name…"
              aria-label="Find or create a project"
              maxLength={LIMITS.projectName}
            />
          </div>
          <div className="popup-target-list" role="listbox" aria-label="Projects">
            {filtered.length === 0 ? (
              <p className="popup-target-empty">
                {projects.length === 0
                  ? 'No projects yet. Type a name below, then choose Create project.'
                  : 'No project matches that name.'}
              </p>
            ) : (
              filtered.map((project) => {
                const active = project.id === selectedProjectId;
                return (
                  <button
                    key={project.id}
                    type="button"
                    role="option"
                    aria-selected={active}
                    className={classNames('popup-target-option', active && 'is-active')}
                    onClick={() => chooseExisting(project.id)}
                  >
                    <FolderClosed size={15} aria-hidden="true" />
                    <span className="popup-target-option-copy">
                      <span className="popup-target-option-name">{project.name}</span>
                      <span className="popup-target-option-meta">
                        {noteCounts.get(project.id) ?? 0}{' '}
                        {(noteCounts.get(project.id) ?? 0) === 1 ? 'notebook' : 'notebooks'}
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
                Create project <strong>“{truncate(query.trim(), 42)}”</strong>
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
        <span>No notebooks in this project yet. Choose “Create New Notebook” instead.</span>
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
          placeholder="Search notebooks…"
          aria-label="Search notebooks"
          disabled={disabled}
        />
      </div>
      <div className="popup-notebook-list" role="listbox" aria-label="Existing notebooks">
        {filtered.length === 0 ? (
          <p className="popup-target-empty">No notebook matches that search.</p>
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
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [newProjectName, setNewProjectName] = useState('');
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

  const projects = data?.projects ?? [];
  const notes = data?.notes ?? [];
  const noteCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const note of notes) map.set(note.projectId, (map.get(note.projectId) ?? 0) + 1);
    return map;
  }, [notes]);

  const projectNotes = useMemo(() => {
    if (!selectedProjectId) return [];
    return notes
      .filter((note) => note.projectId === selectedProjectId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.title.localeCompare(b.title));
  }, [notes, selectedProjectId]);

  useEffect(() => {
    if (selectedProjectId || newProjectName) return;
    if (projects.length === 0) return;
    const recent = [...projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    setSelectedProjectId(recent[0]?.id ?? null);
  }, [newProjectName, projects, selectedProjectId]);

  useEffect(() => {
    if (!selectedProjectId) return;
    if (!projects.some((project) => project.id === selectedProjectId)) {
      setSelectedProjectId(null);
    }
  }, [projects, selectedProjectId]);

  useEffect(() => {
    // Wait for the database before deciding that a project has no notebooks;
    // otherwise the existing-notebook default would flip to "new" while load.
    if (loading || !data || mode !== 'existing') return;
    if (!selectedProjectId && !newProjectName.trim()) {
      // Let the recent-project effect make its selection first when projects
      // exist. With no projects at all, there is nothing to append to.
      if (projects.length > 0) return;
      setMode('new');
      setSelectedNoteId(null);
      return;
    }
    if (projectNotes.length === 0) {
      setMode('new');
      setSelectedNoteId(null);
      return;
    }
    if (projectNotes.some((note) => note.id === selectedNoteId)) return;
    setSelectedNoteId(projectNotes[0]?.id ?? null);
  }, [data, loading, mode, newProjectName, projectNotes, projects, selectedNoteId, selectedProjectId]);

  const wordCount = countWords(text);
  const selectedNote = projectNotes.find((note) => note.id === selectedNoteId) ?? null;
  const canChooseExisting = projectNotes.length > 0 && !newProjectName;
  const canSave =
    capture.status === 'ready' &&
    text.trim().length > 0 &&
    (selectedProjectId !== null || newProjectName.trim().length > 0) &&
    (mode === 'new' || Boolean(selectedNote));

  const close = async () => {
    if (savingRef.current) return;
    await clearCapturePopup();
    window.close();
  };

  const handleSelectExistingProject = (projectId: string) => {
    setSelectedProjectId(projectId);
    setNewProjectName('');
    setError(null);
  };

  const handleSelectNewProject = (name: string) => {
    setNewProjectName(name);
    setSelectedProjectId(null);
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
    if (!selectedProjectId && !newProjectName.trim()) {
      setError('Choose a project, or type a new project name.');
      return;
    }
    if (mode === 'existing' && !selectedNote) {
      setError('Choose the notebook you want to add this selection to.');
      return;
    }
    if (mode === 'existing' && newProjectName) {
      setError('A new project has no notebooks yet. Create a new notebook instead.');
      return;
    }

    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      if (mode === 'existing' && selectedNote) {
        const existingHtml =
          selectedNote.contentHtml ?? markdownToHtml(selectedNote.content);
        const additionHtml = plainTextToHtml(captured);
        const contentHtml = appendHtml(existingHtml, additionHtml);
        const contentText = textFromHtml(contentHtml);
        await notebook.updateNote(selectedNote.id, {
          content: appendAtEnd(
            selectedNote.contentText ?? selectedNote.content,
            textFromHtml(additionHtml),
          ),
          contentHtml,
          contentText,
          // This is the only workflow that marks an existing note as updated.
          // The capture also supersedes the New indicator if it was still set.
          browserCapture: false,
          hasUnseenUpdate: true,
        });
      } else {
        const input = {
          title: titleFromSelection(captured),
          content: captured,
          contentHtml: plainTextToHtml(captured),
          contentText: textFromHtml(plainTextToHtml(captured)),
          // Only brand-new elements from the capture popup get the canvas
          // indicator. Appending to an existing note updates that element.
          browserCapture: true,
        };
        if (newProjectName.trim()) {
          await notebook.createProjectWithNote({ name: newProjectName.trim() }, input);
        } else if (selectedProjectId) {
          await notebook.createNote({ ...input, projectId: selectedProjectId });
        } else {
          throw new Error('Choose a project for this notebook.');
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
            <span className="field-label">Project</span>
            {newProjectName ? <span className="popup-badge">New</span> : null}
          </div>
          <ProjectTarget
            projects={projects}
            noteCounts={noteCounts}
            selectedProjectId={selectedProjectId}
            newProjectName={newProjectName}
            disabled={saving}
            onSelectExisting={handleSelectExistingProject}
            onSelectNew={handleSelectNewProject}
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
                <span className="popup-mode-title">Create New Notebook</span>
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
                <span className="popup-mode-title">Save to Existing Notebook</span>
              </span>
              <span className="popup-mode-check">
                {mode === 'existing' ? <Check size={14} aria-hidden="true" /> : null}
              </span>
            </button>
          </div>

          {mode === 'existing' ? (
            <NotebookPicker
              notes={projectNotes}
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
            {mode === 'existing' ? 'Save to Existing Notebook' : 'Create New Notebook'}
          </Button>
        </div>
      </footer>
    </div>
  );
}
