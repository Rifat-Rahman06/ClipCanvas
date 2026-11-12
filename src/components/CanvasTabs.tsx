import { useEffect, useRef, type KeyboardEvent } from 'react';
import { Layers, Maximize2, Menu, Plus, Search, X } from 'lucide-react';
import type { Canvas } from '../types';
import { classNames } from '../lib/utils';
import { openClipCanvasInTab } from '../services/extension/openInTab';
import { IconButton } from './Button';

interface CanvasTabsProps {
  canvases: Canvas[];
  activeCanvasId: string | null;
  view: 'canvas' | 'search' | 'settings';
  showSidebarButton: boolean;
  pendingCanvasIds: Set<string>;
  onToggleSidebar: () => void;
  onSelectTab: (canvasId: string) => void;
  onCloseTab: (canvasId: string) => void;
  onNewCanvas: () => void;
  onSearch: () => void;
}

export function CanvasTabs({
  canvases,
  activeCanvasId,
  view,
  showSidebarButton,
  pendingCanvasIds,
  onToggleSidebar,
  onSelectTab,
  onCloseTab,
  onNewCanvas,
  onSearch,
}: CanvasTabsProps) {
  const stripRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const active = stripRef.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    active?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeCanvasId, canvases.length]);

  const handleStripKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    const tabs = [
      ...(stripRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? []),
    ];
    if (tabs.length === 0) return;
    const index = tabs.findIndex((tab) => tab === document.activeElement);
    event.preventDefault();
    const nextIndex =
      event.key === 'ArrowRight'
        ? (index + 1) % tabs.length
        : (index - 1 + tabs.length) % tabs.length;
    const next = tabs[nextIndex];
    next.focus();
    const canvasId = next.dataset.canvasId;
    if (canvasId) onSelectTab(canvasId);
  };

  return (
    <header className="topbar">
      {showSidebarButton ? (
        <div className="topbar-leading">
          <IconButton label="Open sidebar" onClick={onToggleSidebar}>
            <Menu size={18} />
          </IconButton>
        </div>
      ) : null}

      <div
        className="note-tabs"
        role="tablist"
        aria-label="Open canvases"
        ref={stripRef}
        onKeyDown={handleStripKeyDown}
      >
        {canvases.length === 0 ? (
          <span className="topbar-placeholder">Research notebook</span>
        ) : (
          canvases.map((canvas) => {
            const active = view === 'canvas' && canvas.id === activeCanvasId;
            const pending = pendingCanvasIds.has(canvas.id);
            return (
              <div
                className={classNames(
                  'note-tab-wrap',
                  active && 'is-active',
                  pending && 'is-pending',
                )}
                key={canvas.id}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={active}
                  aria-busy={pending || undefined}
                  className="note-tab"
                  data-canvas-id={canvas.id}
                  tabIndex={active ? 0 : -1}
                  onClick={() => onSelectTab(canvas.id)}
                  title={canvas.name}
                >
                  <Layers size={13} aria-hidden="true" />
                  <span>{canvas.name}</span>
                </button>
                <button
                  type="button"
                  className="note-tab-close"
                  aria-label={`Close ${canvas.name} tab`}
                  onClick={() => onCloseTab(canvas.id)}
                >
                  <X size={12} />
                </button>
              </div>
            );
          })
        )}
        <button
          type="button"
          className="note-tab-add"
          aria-label="New canvas"
          title="New canvas"
          onClick={onNewCanvas}
        >
          <Plus size={15} />
        </button>
      </div>

      <div className="topbar-actions">
        <IconButton label="Search current canvas" onClick={onSearch} size="sm">
          <Search size={17} />
        </IconButton>
        <IconButton
          label="Open ClipCanvas in a new tab"
          onClick={() =>
            void openClipCanvasInTab({ canvasId: activeCanvasId }).catch(() => undefined)
          }
          size="sm"
        >
          <Maximize2 size={17} />
        </IconButton>
      </div>
    </header>
  );
}
