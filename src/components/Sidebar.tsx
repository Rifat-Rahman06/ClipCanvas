import { useEffect, useMemo, useState } from 'react';
import {
  ChevronRight,
  FileText,
  FolderInput,
  Image as ImageIcon,
  Layers,
  LockKeyhole,
  Pencil,
  Plus,
  Settings,
  Trash2,
  X,
} from 'lucide-react';
import type { Canvas, Note } from '../types';
import { classNames, formatShortDate, noteDisplayTitle } from '../lib/utils';
import { sortCanvases, sortNotes } from '../services/db/repository';
import type { WorkspaceView } from '../hooks/useWorkspace';
import { Brand } from './Brand';
import { IconButton } from './Button';
import { ActionMenu } from './ActionMenu';
import { EmptyState } from './EmptyState';

export type NoteMenuAction = 'rename' | 'move' | 'delete';
export type CanvasMenuAction = 'delete';

interface SidebarProps {
  notes: Note[];
  canvases: Canvas[];
  activeNoteId: string | null;
  activeCanvasId: string | null;
  view: WorkspaceView;
  isMobile: boolean;
  onClose: () => void;
  onOpenSettings: () => void;
  onCreateCanvas: () => void;
  onOpenCanvas: (canvasId: string) => void;
  onOpenNote: (noteId: string) => void;
  onCanvasAction: (canvasId: string, action: CanvasMenuAction) => void;
  onNoteAction: (noteId: string, action: NoteMenuAction) => void;
}

export function Sidebar({
  notes,
  canvases,
  activeNoteId,
  activeCanvasId,
  view,
  isMobile,
  onClose,
  onOpenSettings,
  onCreateCanvas,
  onOpenCanvas,
  onOpenNote,
  onCanvasAction,
  onNoteAction,
}: SidebarProps) {
  const [collapsedCanvases, setCollapsedCanvases] = useState<Set<string>>(new Set());

  const sortedCanvases = useMemo(() => sortCanvases(canvases), [canvases]);
  const notesByCanvas = useMemo(() => {
    const map = new Map<string, Note[]>();
    for (const note of notes) {
      const list = map.get(note.canvasId) ?? [];
      list.push(note);
      map.set(note.canvasId, list);
    }
    for (const [canvasId, list] of map) map.set(canvasId, sortNotes(list));
    return map;
  }, [notes]);

  useEffect(() => {
    if (!activeCanvasId) return;
    setCollapsedCanvases((current) => {
      if (!current.has(activeCanvasId)) return current;
      const next = new Set(current);
      next.delete(activeCanvasId);
      return next;
    });
  }, [activeCanvasId]);

  const toggleCanvas = (canvasId: string) => {
    setCollapsedCanvases((current) => {
      const next = new Set(current);
      if (next.has(canvasId)) next.delete(canvasId);
      else next.add(canvasId);
      return next;
    });
  };

  return (
    <aside className={classNames('sidebar', isMobile && 'sidebar-mobile')} aria-label="Notebook navigation">
      <header className="sidebar-head">
        <Brand />
        <div className="sidebar-head-actions">
          <IconButton
            label={isMobile ? 'Close sidebar' : 'Collapse sidebar'}
            onClick={onClose}
          >
            <X size={17} className="sidebar-close-mobile" />
            <ChevronRight size={17} className="sidebar-close-desktop" />
          </IconButton>
        </div>
      </header>

      <div className="sidebar-section-head">
        <span className="sidebar-section-label">
          Canvases
          <span className="sidebar-section-count">{canvases.length}</span>
        </span>
        <IconButton label="New canvas" size="sm" onClick={onCreateCanvas}>
          <Plus size={15} />
        </IconButton>
      </div>

      <div className="project-tree">
        {sortedCanvases.length === 0 ? (
          <div className="sidebar-empty">
            <EmptyState
              icon={Layers}
              title="No canvases yet"
              description="Create a canvas, then add notes and images directly to it."
              compact
              action={
                <button type="button" className="btn btn-soft btn-sm" onClick={onCreateCanvas}>
                  <Plus size={14} />
                  <span>New canvas</span>
                </button>
              }
            />
          </div>
        ) : (
          sortedCanvases.map((canvas) => {
            const canvasElements = notesByCanvas.get(canvas.id) ?? [];
            const collapsed = collapsedCanvases.has(canvas.id);
            const isActiveCanvas = canvas.id === activeCanvasId;
            return (
              <section
                className={classNames('canvas-group', 'sidebar-canvas-group', isActiveCanvas && 'is-active')}
                key={canvas.id}
              >
                <div className={classNames('sidebar-canvas-row', isActiveCanvas && 'is-active')}>
                  <button
                    type="button"
                    className="canvas-toggle"
                    onClick={() => toggleCanvas(canvas.id)}
                    aria-expanded={!collapsed}
                    aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${canvas.name}`}
                  >
                    <ChevronRight
                      size={13}
                      className={classNames('project-chevron', !collapsed && 'is-open')}
                    />
                  </button>
                  <button
                    type="button"
                    className={classNames('canvas-row', isActiveCanvas && 'is-active')}
                    onClick={() => onOpenCanvas(canvas.id)}
                    aria-current={isActiveCanvas ? 'page' : undefined}
                  >
                    <Layers size={14} className="canvas-row-icon" aria-hidden="true" />
                    <span className="canvas-row-name" title={canvas.name}>
                      {canvas.name}
                    </span>
                    <span className="project-count">{canvasElements.length}</span>
                  </button>
                  <div className="canvas-row-actions">
                    <ActionMenu
                      label={`Actions for ${canvas.name}`}
                      items={[
                        {
                          label: 'Delete canvas',
                          icon: Trash2,
                          danger: true,
                          onSelect: () => onCanvasAction(canvas.id, 'delete'),
                        },
                      ]}
                    />
                  </div>
                </div>

                {!collapsed ? (
                  canvasElements.length > 0 ? (
                    <div className="project-notes canvas-notes">
                      {canvasElements.map((note) => {
                        const active = note.id === activeNoteId && isActiveCanvas;
                        const isImage = note.kind === 'image';
                        return (
                          <div
                            className={classNames('note-row', active && 'is-active')}
                            key={note.id}
                          >
                            <button
                              type="button"
                              className="note-row-main"
                              onClick={() => onOpenNote(note.id)}
                              aria-current={active ? 'page' : undefined}
                            >
                              {isImage ? (
                                <ImageIcon size={14} className="note-row-icon" aria-hidden="true" />
                              ) : (
                                <FileText size={14} className="note-row-icon" aria-hidden="true" />
                              )}
                              <span className="note-row-title" title={noteDisplayTitle(note)}>
                                {noteDisplayTitle(note)}
                              </span>
                              <span className="note-row-date">{formatShortDate(note.updatedAt)}</span>
                            </button>
                            <div className="note-row-actions">
                              <ActionMenu
                                label={`Actions for ${noteDisplayTitle(note)}`}
                                items={[
                                  {
                                    label: 'Rename',
                                    icon: Pencil,
                                    onSelect: () => onNoteAction(note.id, 'rename'),
                                  },
                                  {
                                    label: 'Move to canvas',
                                    icon: FolderInput,
                                    onSelect: () => onNoteAction(note.id, 'move'),
                                  },
                                  {
                                    label: 'Delete note',
                                    icon: Trash2,
                                    danger: true,
                                    separatorBefore: true,
                                    onSelect: () => onNoteAction(note.id, 'delete'),
                                  },
                                ]}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="project-canvas-empty">Empty canvas</p>
                  )
                ) : null}
              </section>
            );
          })
        )}
      </div>

      <footer className="sidebar-footer">
        <nav className="sidebar-nav" aria-label="Notebook tools">
          <button
            type="button"
            className={classNames('sidebar-nav-item', view === 'settings' && 'is-active')}
            onClick={onOpenSettings}
          >
            <Settings size={16} />
            <span>Settings & data</span>
          </button>
        </nav>
        <div className="sidebar-privacy">
          <LockKeyhole size={12} aria-hidden="true" />
          <span>Stored on this device</span>
        </div>
      </footer>
    </aside>
  );
}
