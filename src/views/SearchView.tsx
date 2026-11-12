import {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ChevronDown,
  Layers,
  Search,
  SearchX,
  X,
} from 'lucide-react';
import type { NotebookDataset } from '../types';
import { classNames, formatRelativeTime, noteDisplayTitle } from '../lib/utils';
import { buildSearchIndex, searchNotebook } from '../services/search/search';
import { IconButton } from '../components/Button';
import { EmptyState, HighlightText } from '../components/EmptyState';

interface SearchViewProps {
  data: NotebookDataset;
  onOpenNote: (noteId: string) => void;
  onClose: () => void;
}

export function SearchView({ data, onOpenNote, onClose }: SearchViewProps) {
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [canvasId, setCanvasId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const visibleNotes = useMemo(
    () => data.notes.filter((note) => note.kind !== 'image'),
    [data.notes],
  );
  const index = useMemo(
    () => buildSearchIndex(data.projects, visibleNotes),
    [data.projects, visibleNotes],
  );
  const results = useMemo(
    () => searchNotebook(index, deferredQuery, { projectId: null }),
    [index, deferredQuery],
  );
  const filteredNotes = useMemo(
    () =>
      canvasId
        ? results.notes.filter(({ note }) => note.canvasId === canvasId)
        : results.notes,
    [canvasId, results.notes],
  );
  const canvasNameById = useMemo(
    () => new Map(data.canvases.map((canvas) => [canvas.id, canvas.name])),
    [data.canvases],
  );
  const hasFilters = Boolean(canvasId);
  const hasQuery = deferredQuery.trim().length > 0;
  const hasResults = filteredNotes.length > 0;

  useEffect(() => {
    const timer = window.setTimeout(() => inputRef.current?.focus(), 40);
    return () => window.clearTimeout(timer);
  }, []);

  const clearAll = () => {
    setQuery('');
    setCanvasId(null);
    inputRef.current?.focus();
  };

  return (
    <div className="view-page search-view">
      <header className="view-header">
        <div>
          <span className="eyebrow">Across the whole notebook</span>
          <h1>Search</h1>
        </div>
        <IconButton label="Close search" onClick={onClose}>
          <X size={17} />
        </IconButton>
      </header>

      <div className="search-field">
        <Search size={17} className="search-field-icon" aria-hidden="true" />
        <input
          ref={inputRef}
          type="search"
          value={query}
          placeholder="Search notes and canvases…"
          aria-label="Search the notebook"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && query) {
              event.preventDefault();
              setQuery('');
            }
          }}
        />
        {query ? (
          <button
            type="button"
            className="search-field-clear"
            aria-label="Clear search"
            onClick={() => {
              setQuery('');
              inputRef.current?.focus();
            }}
          >
            <X size={14} />
          </button>
        ) : null}
        <kbd className="search-field-kbd">Ctrl K</kbd>
      </div>

      <div className="search-filters">
        <label className="select-wrap">
          <span className="sr-only">Filter by canvas</span>
          <Layers size={14} className="select-icon" aria-hidden="true" />
          <select
            className="select"
            value={canvasId ?? ''}
            onChange={(event) => setCanvasId(event.target.value || null)}
          >
            <option value="">All canvases</option>
            {data.canvases.map((canvas) => (
              <option key={canvas.id} value={canvas.id}>
                {canvas.name}
              </option>
            ))}
          </select>
          <ChevronDown size={14} className="select-chevron" aria-hidden="true" />
        </label>

        {hasQuery || hasFilters ? (
          <button type="button" className="text-button search-clear" onClick={clearAll}>
            Clear
          </button>
        ) : null}
      </div>

      <div className="search-results">
        {!hasQuery && !hasFilters ? (
          <div className="search-start">
            <EmptyState
              icon={Search}
              title="Find anything you have saved"
              description="Search across note titles and note content. Start typing, or filter by a canvas above."
            />
          </div>
        ) : !hasResults ? (
          <EmptyState
            icon={SearchX}
            title="No matches found"
            description={
              hasFilters
                ? 'Try a different phrase, or remove the canvas filter.'
                : `Nothing in your notebook matches “${deferredQuery.trim()}”. Try a shorter or different phrase.`
            }
            action={
              <button type="button" className="btn btn-secondary btn-sm" onClick={clearAll}>
                Clear search
              </button>
            }
          />
        ) : (
          <>
            <div className="search-summary">
              <span>
                {filteredNotes.length} {filteredNotes.length === 1 ? 'note' : 'notes'}
                {hasFilters ? ' in this canvas' : ''}
              </span>
            </div>

            <section className="search-section" aria-labelledby="search-notes-heading">
              <h2 className="search-section-heading" id="search-notes-heading">
                Notes
              </h2>
              <div className="search-note-list">
                {filteredNotes.map(({ note, snippet, snippetField }) => (
                  <button
                    type="button"
                    className="search-note-result"
                    key={note.id}
                    onClick={() => onOpenNote(note.id)}
                  >
                    <span className="search-result-project">
                      <Layers size={12} />
                      {canvasNameById.get(note.canvasId) ?? 'Canvas'}
                      <span className="search-result-dot">·</span>
                      <span title={note.updatedAt}>{formatRelativeTime(note.updatedAt)}</span>
                    </span>
                    <span className="search-result-title">
                      <HighlightText text={noteDisplayTitle(note)} query={deferredQuery} />
                    </span>
                    {snippet ? (
                      <span className={classNames('search-result-snippet', `snippet-${snippetField}`)}>
                        <HighlightText text={snippet} query={deferredQuery} />
                      </span>
                    ) : (
                      <span className="search-result-snippet is-empty">No content yet</span>
                    )}
                    <span className="search-result-footer">
                      <span className="search-result-open">Open</span>
                    </span>
                  </button>
                ))}
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
