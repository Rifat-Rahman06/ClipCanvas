import { useMemo } from 'react';
import {
  ArrowRight,
  BookOpen,
  Clock3,
  FileText,
  Image as ImageIcon,
  Layers,
  LockKeyhole,
  Plus,
  ScanText,
  Search,
  Sparkles,
} from 'lucide-react';
import type { Canvas, Note } from '../types';
import {
  formatRelativeTime,
  noteDisplayTitle,
  textFromMarkdown,
  truncate,
} from '../lib/utils';
import { sortCanvases } from '../services/db/repository';
import { ClipCanvasMark } from '../components/Brand';
import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';

interface HomeViewProps {
  notes: Note[];
  canvases: Canvas[];
  onCreateCanvas: () => void;
  onOpenCanvas: (canvasId: string) => void;
  onOpenNote: (noteId: string) => void;
  onOpenSearch: () => void;
}

function sortRecent(notes: Note[]): Note[] {
  return [...notes].sort(
    (a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.createdAt.localeCompare(a.createdAt),
  );
}

export function HomeView({
  notes,
  canvases,
  onCreateCanvas,
  onOpenCanvas,
  onOpenNote,
  onOpenSearch,
}: HomeViewProps) {
  const recentNotes = useMemo(() => sortRecent(notes).slice(0, 6), [notes]);
  const sortedCanvases = useMemo(() => sortCanvases(canvases), [canvases]);
  const notesByCanvas = useMemo(() => {
    const map = new Map<string, Note[]>();
    for (const note of notes) {
      const list = map.get(note.canvasId) ?? [];
      list.push(note);
      map.set(note.canvasId, list);
    }
    return map;
  }, [notes]);
  const canvasName = (canvasId: string) =>
    canvases.find((canvas) => canvas.id === canvasId)?.name ?? 'Canvas';

  if (canvases.length === 0) {
    return (
      <div className="view-page home-view">
        <div className="welcome-panel">
          <div className="welcome-mark">
            <ClipCanvasMark size={44} />
          </div>
          <span className="eyebrow">Local-first research notebook</span>
          <h1>Keep what matters from the web.</h1>
          <p className="welcome-copy">
            Capture passages while you read, arrange them directly on named canvases, and return to
            a notebook that stays on your device.
          </p>
          <div className="welcome-actions">
            <Button
              variant="primary"
              icon={<Plus size={15} />}
              onClick={onCreateCanvas}
            >
              Create your first canvas
            </Button>
          </div>
          <div className="welcome-steps">
            <div className="welcome-step">
              <span className="welcome-step-icon">
                <ScanText size={17} />
              </span>
              <strong>Capture</strong>
              <p>Select text on a webpage, then right-click it and choose Save Selection to ClipCanvas.</p>
            </div>
            <div className="welcome-step">
              <span className="welcome-step-icon">
                <Layers size={17} />
              </span>
              <strong>Organize</strong>
              <p>Place notes and images directly on the canvas they belong to.</p>
            </div>
            <div className="welcome-step">
              <span className="welcome-step-icon">
                <BookOpen size={17} />
              </span>
              <strong>Return</strong>
              <p>Find any word inside the canvas you have open.</p>
            </div>
          </div>
          <p className="welcome-privacy">
            <LockKeyhole size={13} aria-hidden="true" />
            No account. No cloud. Your notebook stays in this Chrome profile until you export it.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="view-page home-view">
      <header className="view-header home-header">
        <div>
          <span className="eyebrow">Research notebook</span>
          <h1>Your notebook</h1>
          <p className="view-subtitle">
            {canvases.length} {canvases.length === 1 ? 'canvas' : 'canvases'} ·{' '}
            {notes.length} {notes.length === 1 ? 'element' : 'elements'}
          </p>
        </div>
      </header>

      <div className="home-quick-actions">
        <button type="button" className="quick-action" onClick={onOpenSearch}>
          <span className="quick-action-icon">
            <Search size={17} />
          </span>
          <span>
            <strong>Search</strong>
            <small>In the open canvas</small>
          </span>
          <ArrowRight size={14} className="quick-action-arrow" />
        </button>
        <button type="button" className="quick-action" onClick={onCreateCanvas}>
          <span className="quick-action-icon">
            <Layers size={17} />
          </span>
          <span>
            <strong>New canvas</strong>
            <small>Start another visual space</small>
          </span>
          <ArrowRight size={14} className="quick-action-arrow" />
        </button>
      </div>

      <section className="home-section" aria-labelledby="recent-heading">
        <div className="section-heading">
          <h2 id="recent-heading">Recent elements</h2>
          <span className="section-meta">
            {notes.length > 6 ? `${notes.length} total` : ''}
          </span>
        </div>
        {recentNotes.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="Nothing here yet"
            description="Open a canvas and double-click it to start writing."
            compact
          />
        ) : (
          <div className="recent-notes">
            {recentNotes.map((note) => (
              <button
                type="button"
                className="recent-note"
                key={note.id}
                onClick={() => onOpenNote(note.id)}
              >
                <div className="recent-note-topline">
                  <span className="recent-note-project">
                    {note.kind === 'image' ? <ImageIcon size={12} /> : <Layers size={12} />}
                    {canvasName(note.canvasId)}
                  </span>
                  <span className="recent-note-date" title={note.updatedAt}>
                    <Clock3 size={11} />
                    {formatRelativeTime(note.updatedAt)}
                  </span>
                </div>
                <span className="recent-note-title">{noteDisplayTitle(note)}</span>
                {note.contentText?.trim() || note.content.trim() ? (
                  <span className="recent-note-snippet">
                    {truncate(note.contentText || textFromMarkdown(note.content), 130)}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="home-section" aria-labelledby="canvases-heading">
        <div className="section-heading">
          <h2 id="canvases-heading">Canvases</h2>
          <button type="button" className="text-button" onClick={onCreateCanvas}>
            <Plus size={13} />
            New canvas
          </button>
        </div>
        <div className="home-projects">
          {sortedCanvases.map((canvas) => {
            const canvasNotes = notesByCanvas.get(canvas.id) ?? [];
            return (
              <div className="home-project" key={canvas.id}>
                <div className="home-project-icon">
                  <Layers size={17} />
                </div>
                <div className="home-project-copy">
                  <span className="home-project-name">{canvas.name}</span>
                  <span className="home-project-meta">
                    {canvasNotes.length} {canvasNotes.length === 1 ? 'element' : 'elements'}
                  </span>
                </div>
                <button
                  type="button"
                  className="home-project-action"
                  onClick={() => onOpenCanvas(canvas.id)}
                >
                  Open
                  <ArrowRight size={13} />
                </button>
              </div>
            );
          })}
        </div>
      </section>

      <div className="home-footer-note">
        <Sparkles size={13} aria-hidden="true" />
        <span>
          Open the sidebar to see every canvas and element. Tip: press <kbd>Ctrl</kbd>{' '}
          <kbd>K</kbd> to search.
        </span>
      </div>
    </div>
  );
}
