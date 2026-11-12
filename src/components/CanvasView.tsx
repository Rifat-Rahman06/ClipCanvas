import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { Editor } from '@tiptap/react';
import {
  Background,
  BackgroundVariant,
  NodeToolbar,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  NodeResizer,
  NodeResizeControl,
  ResizeControlVariant,
  getNodesBounds,
  getViewportForBounds,
  useNodesState,
  useReactFlow,
  useStore,
  useViewport,
  type Node,
  type NodeProps,
  type OnMoveEnd,
  type OnNodeDrag,
  type OnResize,
  type OnResizeEnd,
  type OnResizeStart,
  type Viewport,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { ChevronDown, ChevronUp, Plus, Scan, Search, StickyNote, X } from 'lucide-react';
import {
  CANVAS_MAX_ZOOM,
  CANVAS_MIN_ZOOM,
  SINGLE_CLICK_ZOOM_MAX,
  SINGLE_CLICK_ZOOM_MIN,
  TOUCHPAD_ZOOM_SENSITIVITY_DEFAULT,
  TOUCHPAD_ZOOM_SENSITIVITY_MAX,
  TOUCHPAD_ZOOM_SENSITIVITY_MIN,
  type AppSettings,
  type Canvas,
  type Note,
  type NoteInsertion,
  type NoteLayout,
  type NotePatch,
  type UpdateNoteOptions,
} from '../types';
import { defaultNoteLayout } from '../services/db/repository';
import { Button, IconButton } from './Button';
import { ActiveNoteToolbar, type NoteFormatAction } from './ActiveNoteToolbar';
import {
  NoteCard,
  type BeginEditOptions,
  type EditAnchor,
  type NoteCardAction,
} from './NoteCard';

// How much space to leave around the caret before the viewport follows it.
const CARET_VIEWPORT_MARGIN = 20;
// Targets that must never start an empty-canvas note creation.
const CANVAS_DOUBLE_CLICK_IGNORE =
  '.react-flow__node, .note-card, .note-anchored-toolbar, .react-flow__panel, ' +
  '.canvas-empty, button, a, input, textarea, select, [contenteditable="true"]';

// Single-click focus used to use one fixed zoom everywhere. In a full-size tab
// that leaves most of the canvas empty, while a narrow side panel can clip a
// wide element. Aim for a readable target width derived from both viewport
// dimensions, then let the user scale that automatic result.
const FOCUS_TARGET_WIDTH_RATIO = 0.78;
const FOCUS_TARGET_WIDTH_HEIGHT_RATIO = 1.2;
const FOCUS_TARGET_WIDTH_MIN = 280;
const FOCUS_TARGET_WIDTH_MAX = 980;
const FOCUS_ZOOM_MIN = 0.3;
const FOCUS_ZOOM_MAX = CANVAS_MAX_ZOOM;

// The selected-element toolbar is a single narrow column of small icon buttons.
// Keep its measured footprint here so the right side is chosen whenever it
// actually fits, instead of falling back to the left too eagerly.
const TOOLBAR_GAP = 8;
const TOOLBAR_WIDTH = 36;
const TOOLBAR_HALF_HEIGHT = 92;

const SEARCH_HIGHLIGHT_ALL = 'clipcanvas-canvas-search-all';
const SEARCH_HIGHLIGHT_CURRENT = 'clipcanvas-canvas-search-current';

interface CanvasSearchMatch {
  noteId: string;
  range: Range;
}

interface HighlightRegistryLike {
  set: (name: string, highlight: unknown) => void;
  delete: (name: string) => void;
}

type HighlightConstructorLike = new (...ranges: Range[]) => unknown;

function getSearchHighlightSupport(): {
  registry: HighlightRegistryLike;
  Highlight: HighlightConstructorLike;
} | null {
  if (typeof window === 'undefined' || typeof CSS === 'undefined') return null;
  const registry = (CSS as unknown as { highlights?: HighlightRegistryLike }).highlights;
  const HighlightCtor = (window as unknown as { Highlight?: HighlightConstructorLike })
    .Highlight;
  return registry && HighlightCtor ? { registry, Highlight: HighlightCtor } : null;
}

function clearCanvasSearchHighlights() {
  const support = getSearchHighlightSupport();
  if (!support) return;
  support.registry.delete(SEARCH_HIGHLIGHT_ALL);
  support.registry.delete(SEARCH_HIGHLIGHT_CURRENT);
}

function applyCanvasSearchHighlights(matches: CanvasSearchMatch[], activeIndex: number) {
  const support = getSearchHighlightSupport();
  if (!support) return;
  const currentIndex =
    matches.length > 0
      ? Math.min(Math.max(activeIndex, 0), matches.length - 1)
      : -1;
  const otherRanges = matches
    .filter((_match, index) => index !== currentIndex)
    .map((match) => match.range);

  if (otherRanges.length > 0) {
    support.registry.set(
      SEARCH_HIGHLIGHT_ALL,
      new support.Highlight(...otherRanges),
    );
  } else {
    support.registry.delete(SEARCH_HIGHLIGHT_ALL);
  }

  if (currentIndex >= 0) {
    support.registry.set(
      SEARCH_HIGHLIGHT_CURRENT,
      new support.Highlight(matches[currentIndex].range),
    );
  } else {
    support.registry.delete(SEARCH_HIGHLIGHT_CURRENT);
  }
}

function escapeSearchPattern(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function collectCanvasSearchMatches(
  container: HTMLElement,
  rawQuery: string,
): CanvasSearchMatch[] {
  const query = rawQuery.trim();
  if (!query) return [];

  const pattern = new RegExp(escapeSearchPattern(query), 'giu');
  const cards = container.querySelectorAll<HTMLElement>(
    '.react-flow__node[data-id] .note-card',
  );
  const matches: CanvasSearchMatch[] = [];

  for (const card of cards) {
    const noteId = card.closest('.react-flow__node')?.getAttribute('data-id');
    if (!noteId) continue;

    const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const text = node.nodeValue;
        if (!text || !text.trim()) return NodeFilter.FILTER_REJECT;
        const parent = node.parentElement;
        if (
          !parent ||
          parent.closest('[hidden], .note-preview-empty, .note-badge')
        ) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    let textNode = walker.nextNode();
    while (textNode) {
      const text = textNode.nodeValue ?? '';
      pattern.lastIndex = 0;
      let hit = pattern.exec(text);
      while (hit) {
        if (hit[0].length === 0) {
          pattern.lastIndex += 1;
          hit = pattern.exec(text);
          continue;
        }
        const range = document.createRange();
        range.setStart(textNode, hit.index);
        range.setEnd(textNode, hit.index + hit[0].length);
        matches.push({ noteId, range });
        hit = pattern.exec(text);
      }
      textNode = walker.nextNode();
    }
  }

  return matches;
}

function focusZoomForElement(
  elementWidth: number,
  viewportWidth: number,
  viewportHeight: number,
): number {
  const targetWidth = Math.min(
    FOCUS_TARGET_WIDTH_MAX,
    Math.max(
      FOCUS_TARGET_WIDTH_MIN,
      Math.min(
        viewportWidth * FOCUS_TARGET_WIDTH_RATIO,
        viewportHeight * FOCUS_TARGET_WIDTH_HEIGHT_RATIO,
      ),
    ),
  );
  return Math.min(
    FOCUS_ZOOM_MAX,
    Math.max(FOCUS_ZOOM_MIN, targetWidth / Math.max(1, elementWidth)),
  );
}

/**
 * Returns the vertical viewport shift (in flow units) needed to keep the
 * focused collapsed caret inside the canvas. Positive values move the content
 * up. The caret itself is measured in screen coordinates, so the shift is
 * divided by the zoom.
 */
function caretShiftForNode(id: string, zoom: number): number {
  if (typeof window === 'undefined' || !Number.isFinite(zoom) || zoom <= 0) return 0;
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || !active.isContentEditable) return 0;
  const nodeElement = active.closest('.react-flow__node');
  if (!nodeElement || nodeElement.getAttribute('data-id') !== id) return 0;
  const container = nodeElement.closest('.react-flow');
  if (!(container instanceof HTMLElement)) return 0;

  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return 0;
  // Ctrl+A and dragged text selections intentionally span content. Moving the
  // canvas while a multi-character selection is being built makes the
  // selection jump, so only follow a collapsed caret.
  if (!selection.isCollapsed) return 0;

  let rect: DOMRect | null = null;
  const focusNode = selection.focusNode;
  if (focusNode && !nodeElement.contains(focusNode)) return 0;
  if (focusNode) {
    try {
      const caret = document.createRange();
      caret.setStart(focusNode, selection.focusOffset);
      caret.collapse(true);
      // A collapsed caret in a just-inserted empty paragraph can report no
      // client rects at all. Its bounding rect is then (0, 0, 0, 0), which must
      // not be mistaken for a caret above the canvas or the viewport would
      // jump as soon as Enter is pressed.
      if (caret.getClientRects().length > 0) rect = caret.getBoundingClientRect();
    } catch {
      rect = null;
    }
  }
  // Fall back to the selection range when the collapsed caret has no usable
  // rectangle (an empty paragraph can report a zero rect in some browsers).
  if (!rect) {
    if (selection.rangeCount === 0) return 0;
    const range = selection.getRangeAt(0);
    if (range.getClientRects().length === 0) return 0;
    rect = range.getBoundingClientRect();
  }
  if (!rect || !Number.isFinite(rect.top) || !Number.isFinite(rect.bottom)) return 0;
  // An all-zero rect is a missing measurement, not the top-left of the canvas.
  if (rect.width === 0 && rect.height === 0 && rect.left === 0 && rect.top === 0) return 0;

  const containerRect = container.getBoundingClientRect();
  const safeTop = containerRect.top + CARET_VIEWPORT_MARGIN;
  const safeBottom = containerRect.bottom - CARET_VIEWPORT_MARGIN;
  if (rect.top < safeTop) return (rect.top - safeTop) / zoom;
  if (rect.bottom > safeBottom) return (rect.bottom - safeBottom) / zoom;
  return 0;
}

interface NoteNodeData extends Record<string, unknown> {
  note: Note;
  fontSize: number;
  autosaveDelayMs: number;
  defaultNoteWidth: number;
  active: boolean;
  editing: boolean;
  resizing: boolean;
  discardWhenEmpty: boolean;
  insertion: NoteInsertion | null;
  onUpdateNote: (
    id: string,
    patch: NotePatch,
    options?: UpdateNoteOptions,
  ) => Promise<Note>;
  onNoteSaveStatusChange: (noteId: string, pending: boolean) => void;
  onInsertionApplied: (nonce: number) => void;
  onNoteAction: (noteId: string, action: NoteCardAction) => void;
  onActivate: (noteId: string) => void;
  onBeginEdit: (noteId: string, options?: BeginEditOptions) => void;
  onBeginResize: (noteId: string) => void;
  onEndResize: (noteId: string) => void;
  onEditorReady: (noteId: string, editor: Editor | null) => void;
  onDiscardEmpty: (noteId: string) => void;
  onFormat: (noteId: string, action: NoteFormatAction) => void;
  onInsertSelection: () => void;
  onLayoutChange: (noteId: string, layout: NoteLayout) => void;
}

type NoteCanvasNode = Node<NoteNodeData, 'note'>;

function noteWidthIsLocked(layout: NoteLayout | undefined): boolean {
  // Older manually resized elements predate the explicit width flag.
  return layout?.widthLocked ?? layout?.heightLocked ?? false;
}

function sameLayout(a: NoteLayout, b: NoteLayout): boolean {
  return (
    a.x === b.x &&
    a.y === b.y &&
    a.width === b.width &&
    a.height === b.height &&
    a.zIndex === b.zIndex &&
    Boolean(a.heightLocked) === Boolean(b.heightLocked) &&
    Boolean(a.widthLocked) === Boolean(b.widthLocked)
  );
}

interface CanvasViewProps {
  canvas: Canvas;
  notes: Note[];
  settings: AppSettings;
  activeNoteId: string | null;
  insertion: NoteInsertion | null;
  revealRequest: { noteId: string; nonce: number } | null;
  editRequest: {
    noteId: string;
    nonce: number;
    zoom?: boolean;
    anchor?: { x: number; y: number };
  } | null;
  searchOpen: boolean;
  onSearchClose: () => void;
  discardEmptyNoteIds: Set<string>;
  onUpdateNote: (
    id: string,
    patch: NotePatch,
    options?: UpdateNoteOptions,
  ) => Promise<Note>;
  onNoteSaveStatusChange: (noteId: string, pending: boolean) => void;
  onInsertSelection: () => void;
  onInsertionApplied: (nonce: number) => void;
  onNoteAction: (noteId: string, action: NoteCardAction) => void;
  onActivate: (noteId: string) => void;
  onAddNote: () => void;
  onCanvasImage: (file: File, position: { x: number; y: number }) => void;
  onCanvasText: (
    text: string,
    position: { x: number; y: number },
    html?: string,
  ) => void;
  onCanvasEmptyNote: (
    position: { x: number; y: number },
    options?: { anchor?: { x: number; y: number } },
  ) => void;
  onDiscardEmptyNote: (noteId: string) => void;
  onDeselectNote: () => void;
  onViewportChange: (canvasId: string, viewport: Viewport) => void;
  onNoteLayoutChange: (noteId: string, layout: NoteLayout) => void;
}

export function CanvasView(props: CanvasViewProps) {
  return (
    <ReactFlowProvider>
      <CanvasSurface {...props} />
    </ReactFlowProvider>
  );
}

function CanvasSurface({
  canvas,
  notes,
  settings,
  activeNoteId,
  insertion,
  revealRequest,
  editRequest,
  searchOpen,
  onSearchClose,
  discardEmptyNoteIds,
  onUpdateNote,
  onNoteSaveStatusChange,
  onInsertSelection,
  onInsertionApplied,
  onNoteAction,
  onActivate,
  onAddNote,
  onCanvasImage,
  onCanvasText,
  onCanvasEmptyNote,
  onDiscardEmptyNote,
  onDeselectNote,
  onViewportChange,
  onNoteLayoutChange,
}: CanvasViewProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<NoteCanvasNode>([]);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [resizingNoteId, setResizingNoteId] = useState<string | null>(null);
  const {
    getNode,
    getViewport,
    getZoom,
    screenToFlowPosition,
    setCenter,
    setViewport,
  } = useReactFlow<NoteCanvasNode>();
  const canvasWidth = useStore((state) => state.width);
  const canvasHeight = useStore((state) => state.height);

  const nodeTypes = useMemo(() => ({ note: NoteNode }), []);
  const canvasRef = useRef<HTMLDivElement>(null);
  const pointerRef = useRef({ x: 0, y: 0, inside: false });
  // Where the current press started. A text-selection drag that begins inside
  // a note and ends over the empty pane produces a click on the pane; that
  // gesture must not deselect the element.
  const pressOriginRef = useRef<{ insideNote: boolean } | null>(null);
  const lastCanvasIdRef = useRef<string | null>(null);
  const editZoomTimerRef = useRef<number | null>(null);
  const handledEditRequestRef = useRef(0);
  const editorsRef = useRef(new Map<string, Editor>());
  const pendingFormatRef = useRef<{ noteId: string; action: NoteFormatAction } | null>(null);
  const pendingLayoutsRef = useRef(new Map<string, NoteLayout>());
  const [searchQuery, setSearchQuery] = useState('');
  const [searchMatches, setSearchMatches] = useState<CanvasSearchMatch[]>([]);
  const [activeSearchIndex, setActiveSearchIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchFocusRequestRef = useRef(0);
  // Search moves the viewport on every result. Persisting those moves would
  // update workspace/canvas state while the search input is still being typed.
  const searchViewportMoveAtRef = useRef(0);
  const lastSearchQueryRef = useRef('');
  const viewportInteractedAtRef = useRef(0);
  // The search scanner reads rendered note text. `updatedAt` and the content
  // lengths only change when a note really changes, unlike the notes array,
  // which can be recreated by viewport/layout state updates.
  const searchSourceKey = useMemo(
    () =>
      notes
        .map(
          (note) =>
            `${note.id}:${note.updatedAt}:${note.contentText?.length ?? 0}:${
              note.contentHtml?.length ?? 0
            }`,
        )
        .join('\u0000'),
    [notes],
  );

  const clearEditZoomTimer = useCallback(() => {
    if (editZoomTimerRef.current === null) return;
    window.clearTimeout(editZoomTimerRef.current);
    editZoomTimerRef.current = null;
  }, []);

  const focusNote = useCallback(
    (noteId: string, anchor?: EditAnchor) => {
      const note = notes.find((item) => item.id === noteId);
      const node = getNode(noteId);
      const layout = note?.layout ?? defaultNoteLayout(0, settings.defaultNoteWidth);
      const width = Math.max(
        1,
        Number(
          node?.measured?.width ??
            node?.width ??
            layout.width ??
            settings.defaultNoteWidth,
        ),
      );
      const height = Math.max(
        1,
        Number(node?.measured?.height ?? node?.height ?? layout.height ?? 340),
      );
      const canvasRect = canvasRef.current?.getBoundingClientRect();
      const viewportWidth = canvasWidth > 0 ? canvasWidth : canvasRect?.width ?? 0;
      const viewportHeight = canvasHeight > 0 ? canvasHeight : canvasRect?.height ?? 0;
      const responsiveZoom =
        viewportWidth > 0 && viewportHeight > 0
          ? focusZoomForElement(width, viewportWidth, viewportHeight)
          : 1;
      const zoomMultiplier = Math.min(
        SINGLE_CLICK_ZOOM_MAX,
        Math.max(SINGLE_CLICK_ZOOM_MIN, settings.singleClickZoom),
      );
      const zoom = Math.min(
        FOCUS_ZOOM_MAX,
        Math.max(FOCUS_ZOOM_MIN, responsiveZoom * zoomMultiplier),
      );
      if (anchor) {
        if (canvasRect && viewportWidth > 0) {
          const flowPoint = screenToFlowPosition(anchor);
          const screenY = anchor.y - canvasRect.top;
          const elementCenterX = (node?.position.x ?? layout.x) + width / 2;
          // Follow the clicked line vertically, but always center the whole
          // element horizontally. This gives equal left and right space no
          // matter which part of a wide or tall element was clicked.
          const nextViewport = {
            x: viewportWidth / 2 - elementCenterX * zoom,
            y: screenY - flowPoint.y * zoom,
            zoom,
          };
          if (
            Number.isFinite(nextViewport.x) &&
            Number.isFinite(nextViewport.y) &&
            Number.isFinite(nextViewport.zoom)
          ) {
            void setViewport(nextViewport, { duration: 320 });
            return;
          }
        }
      }
      const x = (node?.position.x ?? layout.x) + width / 2;
      const y = (node?.position.y ?? layout.y) + height / 2;
      void setCenter(x, y, { zoom, duration: 320 });
    },
    [
      canvasHeight,
      canvasWidth,
      getNode,
      notes,
      screenToFlowPosition,
      setCenter,
      setViewport,
      settings.defaultNoteWidth,
      settings.singleClickZoom,
    ],
  );

  const focusSearchMatch = useCallback(
    (match: CanvasSearchMatch) => {
      const canvasElement = canvasRef.current;
      if (!canvasElement) return;
      const requestId = searchFocusRequestRef.current + 1;
      searchFocusRequestRef.current = requestId;
      const note = notes.find((item) => item.id === match.noteId);
      const node = getNode(match.noteId);
      const layout = note?.layout ?? defaultNoteLayout(0, settings.defaultNoteWidth);
      const elementWidth = Math.max(
        1,
        Number(
          node?.measured?.width ??
            node?.width ??
            layout.width ??
            settings.defaultNoteWidth,
        ),
      );
      const canvasRect = canvasElement.getBoundingClientRect();
      const viewportWidth = canvasWidth > 0 ? canvasWidth : canvasRect.width;
      const viewportHeight = canvasHeight > 0 ? canvasHeight : canvasRect.height;
      if (viewportWidth <= 0 || viewportHeight <= 0) return;

      // Wait for the latest canvas frame before measuring and moving the
      // viewport to the highlighted word.
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          // A newer query or navigation request has superseded this one.
          if (searchFocusRequestRef.current !== requestId) return;
          if (!match.range.startContainer.isConnected) return;
          const rect = match.range.getBoundingClientRect();
          if (
            !Number.isFinite(rect.left) ||
            !Number.isFinite(rect.top) ||
            (rect.width === 0 && rect.height === 0)
          ) {
            return;
          }
          const flowPoint = screenToFlowPosition({
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2,
          });
          const desiredZoom = focusZoomForElement(
            elementWidth,
            viewportWidth,
            viewportHeight,
          );
          const zoom = Math.min(
            FOCUS_ZOOM_MAX,
            Math.max(getZoom(), desiredZoom),
          );
          if (!Number.isFinite(flowPoint.x) || !Number.isFinite(flowPoint.y)) return;
          searchViewportMoveAtRef.current = performance.now();
          void setViewport(
            {
              x: viewportWidth / 2 - flowPoint.x * zoom,
              y: viewportHeight / 2 - flowPoint.y * zoom,
              zoom,
            },
            { duration: 280 },
          );
        });
      });
    },
    [
      canvasHeight,
      canvasWidth,
      getNode,
      getZoom,
      notes,
      screenToFlowPosition,
      setViewport,
      settings.defaultNoteWidth,
    ],
  );

  const focusSearchMatchRef = useRef(focusSearchMatch);
  focusSearchMatchRef.current = focusSearchMatch;

  const handleFitCanvas = useCallback(() => {
    if (nodes.length === 0 || canvasWidth <= 0 || canvasHeight <= 0) return;
    const bounds = getNodesBounds(nodes);
    if (
      !Number.isFinite(bounds.x) ||
      !Number.isFinite(bounds.y) ||
      !Number.isFinite(bounds.width) ||
      !Number.isFinite(bounds.height) ||
      bounds.width <= 0 ||
      bounds.height <= 0
    ) {
      return;
    }
    const fitted = getViewportForBounds(
      bounds,
      canvasWidth,
      canvasHeight,
      CANVAS_MIN_ZOOM,
      CANVAS_MAX_ZOOM,
      0.16,
    );
    if (!Number.isFinite(fitted.zoom)) return;
    const zoom = Math.min(
      CANVAS_MAX_ZOOM,
      Math.max(CANVAS_MIN_ZOOM, fitted.zoom),
    );
    // Center the bounding box of the actual elements, not the canvas origin.
    const centerFlowX = bounds.x + bounds.width / 2;
    const centerFlowY = bounds.y + bounds.height / 2;
    void setViewport(
      {
        x: canvasWidth / 2 - centerFlowX * zoom,
        y: canvasHeight / 2 - centerFlowY * zoom,
        zoom,
      },
      { duration: 300 },
    );
  }, [canvasHeight, canvasWidth, nodes, setViewport]);

  const handleBeginEdit = useCallback(
    (noteId: string, options?: BeginEditOptions) => {
      if (editingNoteId === noteId) return;
      setResizingNoteId(null);
      setEditingNoteId(noteId);
      if (activeNoteId !== noteId) onActivate(noteId);
      const note = notes.find((item) => item.id === noteId);
      if (note?.browserCapture || note?.hasUnseenUpdate) {
        // Opening the note consumes both the "New" and "Updated" badges.
        void Promise.resolve(
          onUpdateNote(noteId, {
            browserCapture: false,
            hasUnseenUpdate: false,
          }),
        ).catch(() => undefined);
      }
      clearEditZoomTimer();
      if (options?.zoom) {
        editZoomTimerRef.current = window.setTimeout(() => {
          editZoomTimerRef.current = null;
          focusNote(noteId, options.anchor);
        }, 100);
      }
    },
    [
      activeNoteId,
      clearEditZoomTimer,
      editingNoteId,
      focusNote,
      notes,
      onActivate,
      onUpdateNote,
    ],
  );

  const handleBeginResize = useCallback(
    (noteId: string) => {
      clearEditZoomTimer();
      setEditingNoteId(null);
      setResizingNoteId(noteId);
      if (activeNoteId !== noteId) onActivate(noteId);
    },
    [activeNoteId, clearEditZoomTimer, onActivate],
  );

  const handleEndResize = useCallback((noteId: string) => {
    // Leaving the note in the resizing state keeps the frozen dimensions and
    // clipped overflow from the drag, so text stays cropped after release.
    setResizingNoteId((current) => (current === noteId ? null : current));
  }, []);

  const runFormat = useCallback(
    (noteId: string, action: NoteFormatAction) => {
      const apply = (editor: Editor) => {
        const focusOptions = { scrollIntoView: false };
        if (action === 'bold') editor.chain().focus(undefined, focusOptions).toggleBold().run();
        else editor.chain().focus(undefined, focusOptions).toggleBulletList().run();
      };
      const editor = editorsRef.current.get(noteId);
      if (editor && editingNoteId === noteId) {
        apply(editor);
        return;
      }
      // Formatting from preview mode should open the editor first. If the
      // editor already exists but is hidden, apply once editing has switched on.
      pendingFormatRef.current = { noteId, action };
      handleBeginEdit(noteId);
      if (editor) {
        window.setTimeout(() => {
          const pending = pendingFormatRef.current;
          if (!pending || pending.noteId !== noteId) return;
          pendingFormatRef.current = null;
          apply(editor);
        }, 80);
      }
    },
    [editingNoteId, handleBeginEdit],
  );

  const handleEditorReady = useCallback((noteId: string, editor: Editor | null) => {
    if (!editor) {
      editorsRef.current.delete(noteId);
      return;
    }
    editorsRef.current.set(noteId, editor);
    const pending = pendingFormatRef.current;
    if (pending && pending.noteId === noteId) {
      pendingFormatRef.current = null;
      window.setTimeout(() => {
        const focusOptions = { scrollIntoView: false };
        if (pending.action === 'bold') {
          editor.chain().focus(undefined, focusOptions).toggleBold().run();
        } else {
          editor.chain().focus(undefined, focusOptions).toggleBulletList().run();
        }
      }, 0);
    }
  }, []);

  const handleNoteLayoutChange = useCallback(
    (noteId: string, layout: NoteLayout) => {
      // Keep the final resize/drag geometry visible while the IndexedDB write
      // is in flight. Without this, clearing the active resize state can briefly
      // re-apply the older persisted layout and make a text card shrink.
      pendingLayoutsRef.current.set(noteId, layout);
      // A layout write can finish after its note was deleted (an empty note is
      // discarded on blur), so never let that rejection escape.
      void Promise.resolve(onNoteLayoutChange(noteId, layout)).catch(() => {
        // The note no longer exists; nothing to persist.
      });
    },
    [onNoteLayoutChange],
  );

  const callbacksRef = useRef({
    onUpdateNote,
    onNoteSaveStatusChange,
    onInsertionApplied,
    onNoteAction,
    onActivate,
    onInsertSelection,
    onBeginEdit: handleBeginEdit,
    onBeginResize: handleBeginResize,
    onEndResize: handleEndResize,
    onEditorReady: handleEditorReady,
    onDiscardEmptyNote,
    onFormat: runFormat,
    onNoteLayoutChange: handleNoteLayoutChange,
  });
  callbacksRef.current = {
    onUpdateNote,
    onNoteSaveStatusChange,
    onInsertionApplied,
    onNoteAction,
    onActivate,
    onInsertSelection,
    onBeginEdit: handleBeginEdit,
    onBeginResize: handleBeginResize,
    onEndResize: handleEndResize,
    onEditorReady: handleEditorReady,
    onDiscardEmptyNote,
    onFormat: runFormat,
    onNoteLayoutChange: handleNoteLayoutChange,
  };

  useEffect(() => {
    if (lastCanvasIdRef.current === canvas.id) return;
    lastCanvasIdRef.current = canvas.id;
    pendingLayoutsRef.current.clear();
    setEditingNoteId(null);
    setResizingNoteId(null);
    clearEditZoomTimer();
    void setViewport(canvas.viewport ?? { x: 0, y: 0, zoom: 1 });
    // The saved viewport is intentionally read only when the canvas changes.
    // Saving a pan or zoom updates canvas.viewport without resetting the view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvas.id, clearEditZoomTimer, setViewport]);

  useEffect(() => {
    setNodes((current) => {
      const existing = new Map(current.map((node) => [node.id, node]));
      return notes.map((note, index) => {
        const pendingLayout = pendingLayoutsRef.current.get(note.id);
        if (pendingLayout && note.layout && sameLayout(note.layout, pendingLayout)) {
          pendingLayoutsRef.current.delete(note.id);
        }
        const displayedNote = pendingLayout ? { ...note, layout: pendingLayout } : note;
        const layout =
          displayedNote.layout ?? defaultNoteLayout(index, settings.defaultNoteWidth);
        const previous = existing.get(note.id);
        const moving = Boolean(previous?.dragging || previous?.resizing);
        const editing = note.id === editingNoteId;
        const callbacks = callbacksRef.current;
        const data: NoteNodeData = {
          note: displayedNote,
          fontSize: settings.editorFontSize,
          autosaveDelayMs: Math.round(settings.autosaveDelaySeconds * 1000),
          defaultNoteWidth: settings.defaultNoteWidth,
          active: note.id === activeNoteId,
          editing,
          resizing: note.id === resizingNoteId,
          discardWhenEmpty: discardEmptyNoteIds.has(note.id),
          insertion,
          onUpdateNote: callbacks.onUpdateNote,
          onNoteSaveStatusChange: callbacks.onNoteSaveStatusChange,
          onInsertionApplied: callbacks.onInsertionApplied,
          onNoteAction: callbacks.onNoteAction,
          onActivate: callbacks.onActivate,
          onBeginEdit: callbacks.onBeginEdit,
          onBeginResize: callbacks.onBeginResize,
          onEndResize: callbacks.onEndResize,
          onEditorReady: callbacks.onEditorReady,
          onDiscardEmpty: callbacks.onDiscardEmptyNote,
          onFormat: callbacks.onFormat,
          onInsertSelection: callbacks.onInsertSelection,
          onLayoutChange: callbacks.onNoteLayoutChange,
        };
        const imageNote = note.kind === 'image';
        const resizing = note.id === resizingNoteId;
        const widthLocked = noteWidthIsLocked(layout);
        const effectiveWidth = widthLocked ? layout.width : settings.defaultNoteWidth;
        const imageAspectRatio =
          layout.width > 0 && layout.height > 0 ? layout.width / layout.height : 1;
        const effectiveImageHeight = Math.max(
          80,
          Math.round(effectiveWidth / Math.max(imageAspectRatio, 0.01)),
        );
        const measuredWidth = previous?.measured?.width ?? previous?.width;
        const measuredHeight = previous?.measured?.height ?? previous?.height;
        let style: { width?: number; height?: number };
        if (moving && previous) {
          style = {
            width: previous.style?.width as number | undefined,
            height: previous.style?.height as number | undefined,
          };
        } else if (resizing) {
          // Freeze the element at its rendered size so entering resize mode
          // never shrinks a note whose editor grew beyond the stored layout.
          style = {
            width: measuredWidth ?? effectiveWidth,
            height: measuredHeight ?? (imageNote ? effectiveImageHeight : layout.height),
          };
        } else if (imageNote) {
          style = { width: effectiveWidth, height: effectiveImageHeight };
        } else {
          // Text notes are width-only: their height always follows the content,
          // so nothing is ever cropped and the editor never scrolls internally.
          // A legacy `heightLocked` value is intentionally ignored.
          style = { width: effectiveWidth };
        }
        const dimensions =
          imageNote || resizing
            ? { width: style.width, height: style.height }
            : { width: undefined, height: undefined };
        // While an editor is active, note updates and caret-follow layout
        // writes must not rebuild its React Flow node. The TipTap document is
        // the source of truth, and updating the node during typing can reset
        // the focused selection. The latest note is applied when editing ends.
        const keepEditingNode =
          editing &&
          previous?.data.editing &&
          !moving &&
          previous.data.active === data.active &&
          previous.data.resizing === data.resizing &&
          previous.data.discardWhenEmpty === data.discardWhenEmpty &&
          previous.data.insertion === data.insertion &&
          previous.data.fontSize === data.fontSize &&
          previous.data.defaultNoteWidth === data.defaultNoteWidth &&
          previous.style?.width === style.width &&
          previous.style?.height === style.height;
        if (keepEditingNode) return previous;
        return {
          ...previous,
          ...dimensions,
          id: note.id,
          type: 'note',
          position:
            (moving || editing) && previous
              ? previous.position
              : { x: layout.x, y: layout.y },
          style,
          zIndex: note.id === activeNoteId ? 1000 : layout.zIndex,
          data,
        };
      });
    });
  }, [
    activeNoteId,
    discardEmptyNoteIds,
    editingNoteId,
    resizingNoteId,
    insertion,
    notes,
    setNodes,
    settings.autosaveDelaySeconds,
    settings.defaultNoteWidth,
    settings.editorFontSize,
  ]);

  useEffect(() => {
    if (searchOpen) return;
    searchFocusRequestRef.current += 1;
    searchViewportMoveAtRef.current = 0;
    setSearchQuery('');
    setSearchMatches([]);
    setActiveSearchIndex(0);
    clearCanvasSearchHighlights();
  }, [searchOpen]);

  useEffect(() => {
    if (!searchOpen) return;
    clearEditZoomTimer();
    setEditingNoteId(null);
    setResizingNoteId(null);
  }, [clearEditZoomTimer, searchOpen]);

  useEffect(() => {
    if (!searchOpen) return;
    const timer = window.setTimeout(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    }, 30);
    return () => window.clearTimeout(timer);
  }, [searchOpen]);

  useEffect(() => {
    if (!searchOpen) {
      lastSearchQueryRef.current = '';
      return;
    }
    const query = searchQuery.trim();
    const queryChanged = lastSearchQueryRef.current !== query;
    lastSearchQueryRef.current = query;
    if (!query) {
      setSearchMatches([]);
      setActiveSearchIndex(0);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      const container = canvasRef.current;
      if (!container || cancelled) return;
      const matches = collectCanvasSearchMatches(container, query);
      if (cancelled) return;
      setSearchMatches(matches);
      // A viewport move or autosave can recreate the rendered DOM and make us
      // rescan. Keep the reader on the same match unless the query changed.
      setActiveSearchIndex((current) => {
        if (queryChanged || matches.length === 0) return 0;
        return Math.min(current, matches.length - 1);
      });
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [editingNoteId, searchOpen, searchQuery, searchSourceKey]);

  useEffect(() => {
    if (!searchOpen || searchMatches.length === 0) {
      clearCanvasSearchHighlights();
      return;
    }
    applyCanvasSearchHighlights(searchMatches, activeSearchIndex);
    return () => clearCanvasSearchHighlights();
  }, [activeSearchIndex, searchMatches, searchOpen]);

  useEffect(() => {
    if (!searchOpen || searchMatches.length === 0) return;
    const index = Math.min(activeSearchIndex, searchMatches.length - 1);
    const match = searchMatches[index];
    if (match) focusSearchMatchRef.current(match);
  }, [activeSearchIndex, searchMatches, searchOpen]);

  const closeCanvasSearch = useCallback(() => {
    const searchMovedViewport = searchViewportMoveAtRef.current > 0;
    searchViewportMoveAtRef.current = 0;
    searchFocusRequestRef.current += 1;
    clearCanvasSearchHighlights();
    setSearchQuery('');
    setSearchMatches([]);
    setActiveSearchIndex(0);
    onSearchClose();
    // Persist the final search position once, instead of after every keystroke.
    if (searchMovedViewport) onViewportChange(canvas.id, getViewport());
  }, [canvas.id, getViewport, onSearchClose, onViewportChange]);

  const navigateSearch = useCallback(
    (direction: number) => {
      setActiveSearchIndex((current) => {
        if (searchMatches.length === 0) return 0;
        return (current + direction + searchMatches.length) % searchMatches.length;
      });
    },
    [searchMatches.length],
  );

  useEffect(() => {
    if (editingNoteId && activeNoteId !== editingNoteId) setEditingNoteId(null);
    if (resizingNoteId && activeNoteId !== resizingNoteId) setResizingNoteId(null);
  }, [activeNoteId, editingNoteId, resizingNoteId]);

  useEffect(() => () => clearEditZoomTimer(), [clearEditZoomTimer]);

  useEffect(() => {
    if (!editRequest) return;
    if (handledEditRequestRef.current === editRequest.nonce) return;
    if (!notes.some((note) => note.id === editRequest.noteId)) return;
    handledEditRequestRef.current = editRequest.nonce;
    handleBeginEdit(
      editRequest.noteId,
      editRequest.zoom
        ? { zoom: true, anchor: editRequest.anchor }
        : undefined,
    );
  }, [editRequest, handleBeginEdit, notes]);

  useEffect(() => {
    if (!revealRequest) return;
    const timer = window.setTimeout(() => {
      const node = getNode(revealRequest.noteId);
      if (!node) return;
      const width = Number(
        node.measured?.width ?? node.width ?? node.style?.width ?? 430,
      );
      const height = Number(
        node.measured?.height ?? node.height ?? node.style?.height ?? 340,
      );
      const centerX = node.position.x + (Number.isFinite(width) ? width : 430) / 2;
      const centerY = node.position.y + (Number.isFinite(height) ? height : 340) / 2;
      const zoom = Math.max(0.55, Math.min(1, getZoom()));
      if (
        !Number.isFinite(centerX) ||
        !Number.isFinite(centerY) ||
        !Number.isFinite(zoom)
      ) {
        return;
      }
      void setCenter(centerX, centerY, {
        zoom,
        duration: 360,
      });
    }, 50);
    return () => window.clearTimeout(timer);
  }, [getNode, getZoom, revealRequest, setCenter]);

  const markViewportInteraction = useCallback(() => {
    viewportInteractedAtRef.current = performance.now();
  }, []);

  const handleMoveEnd: OnMoveEnd = useCallback(
    (_event, viewport) => {
      markViewportInteraction();
      // Search results move the viewport locally to reveal each match. Saving
      // those transient moves would recreate canvas state on every keystroke.
      if (performance.now() - searchViewportMoveAtRef.current < 1000) return;
      onViewportChange(canvas.id, viewport);
    },
    [canvas.id, markViewportInteraction, onViewportChange],
  );

  const handleDragStop: OnNodeDrag<NoteCanvasNode> = useCallback(
    (_event, node) => {
      const draggedNote = notes.find((item) => item.id === node.id);
      // A resize may have just completed and still be in flight; prefer the
      // newest geometry over the stale `notes` prop so moving an element never
      // resets its manually chosen size. Only position and stacking change.
      const storedLayout =
        pendingLayoutsRef.current.get(node.id) ??
        node.data.note.layout ??
        draggedNote?.layout;
      const style = node.style ?? {};
      const widthLocked = storedLayout ? noteWidthIsLocked(storedLayout) : false;
      const width = widthLocked
        ? (storedLayout?.width ?? Number(style.width ?? node.width ?? settings.defaultNoteWidth))
        : Number(
            node.measured?.width ??
              style.width ??
              node.width ??
              storedLayout?.width ??
              settings.defaultNoteWidth,
          );
      const height =
        storedLayout?.height ??
        Number(style.height ?? node.height ?? node.measured?.height ?? 340);
      const topZ = notes.reduce(
        (highest, note) => Math.max(highest, note.layout?.zIndex ?? 0),
        0,
      );
      handleNoteLayoutChange(node.id, {
        x: node.position.x,
        y: node.position.y,
        width,
        height,
        zIndex: Math.max(topZ + 1, storedLayout?.zIndex ?? 0),
        heightLocked: storedLayout?.heightLocked,
        widthLocked: storedLayout ? storedLayout.widthLocked : undefined,
      });
    },
    [handleNoteLayoutChange, notes, settings.defaultNoteWidth],
  );

  const addCanvasImages = useCallback(
    (files: File[], clientX: number, clientY: number) => {
      const images = files.filter((file) => file.type.startsWith('image/'));
      images.forEach((file, index) => {
        const position = screenToFlowPosition({
          x: clientX + index * 28,
          y: clientY + index * 28,
        });
        onCanvasImage(file, position);
      });
    },
    [onCanvasImage, screenToFlowPosition],
  );

  useEffect(() => {
    // Clipboard events do not carry pointer coordinates. Track the real cursor
    // at the window level so a paste that follows a keyboard focus change still
    // lands where the pointer actually is over the canvas.
    const updatePointer = (event: PointerEvent) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const inside =
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom;
      pointerRef.current = { x: event.clientX, y: event.clientY, inside };
    };
    window.addEventListener('pointermove', updatePointer, { passive: true });
    window.addEventListener('pointerdown', updatePointer, { passive: true });
    return () => {
      window.removeEventListener('pointermove', updatePointer);
      window.removeEventListener('pointerdown', updatePointer);
    };
  }, []);

  useEffect(() => {
    const canvasElement = canvasRef.current;
    if (!canvasElement) return;
    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      event.stopPropagation();
      const rect = canvasElement.getBoundingClientRect();
      const viewport = getViewport();
      const delta =
        event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 100 : 1);
      // Chrome delivers touchpad pinch gestures as ctrl+wheel events. Scaling
      // the exponent changes only the response inside this canvas; the browser
      // and every other page keep their own gesture handling.
      const sensitivity = Math.min(
        TOUCHPAD_ZOOM_SENSITIVITY_MAX,
        Math.max(
          TOUCHPAD_ZOOM_SENSITIVITY_MIN,
          settings.touchpadZoomSensitivity || TOUCHPAD_ZOOM_SENSITIVITY_DEFAULT,
        ),
      );
      const factor = Math.exp(-delta * 0.0018 * sensitivity);
      const zoom = Math.min(
        CANVAS_MAX_ZOOM,
        Math.max(CANVAS_MIN_ZOOM, viewport.zoom * factor),
      );
      if (zoom === viewport.zoom) return;
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const flowX = (x - viewport.x) / viewport.zoom;
      const flowY = (y - viewport.y) / viewport.zoom;
      void setViewport({
        x: x - flowX * zoom,
        y: y - flowY * zoom,
        zoom,
      });
    };
    canvasElement.addEventListener('wheel', handleWheel, { passive: false, capture: true });
    return () => canvasElement.removeEventListener('wheel', handleWheel, { capture: true });
  }, [getViewport, setViewport, settings.touchpadZoomSensitivity]);

  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      if (event.defaultPrevented) return;
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest(
          '.note-card, .note-anchored-toolbar, input, textarea, select, [contenteditable="true"]',
        )
      ) {
        return;
      }

      const rect = canvasRef.current?.getBoundingClientRect();
      const pasteX = pointerRef.current.inside
        ? pointerRef.current.x
        : rect
          ? rect.left + rect.width / 2
          : window.innerWidth / 2;
      const pasteY = pointerRef.current.inside
        ? pointerRef.current.y
        : rect
          ? rect.top + rect.height / 2
          : window.innerHeight / 2;

      const files = event.clipboardData?.files;
      const images = files
        ? [...files].filter((file) => file.type.startsWith('image/'))
        : [];
      if (images.length > 0) {
        event.preventDefault();
        addCanvasImages(images, pasteX, pasteY);
        return;
      }

      const text = event.clipboardData?.getData('text/plain') ?? '';
      const html = event.clipboardData?.getData('text/html') ?? '';
      if (!text.trim() && !html.trim()) return;
      event.preventDefault();
      onCanvasText(
        text,
        screenToFlowPosition({ x: pasteX, y: pasteY }),
        html || undefined,
      );
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [addCanvasImages, onCanvasText, screenToFlowPosition]);

  const handleDragOver = (event: ReactDragEvent<HTMLDivElement>) => {
    const target = event.target;
    if (target instanceof Element && target.closest('.note-card')) return;
    if ([...event.dataTransfer.items].some((item) => item.kind === 'file')) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    }
  };

  const handleDrop = (event: ReactDragEvent<HTMLDivElement>) => {
    const target = event.target;
    if (target instanceof Element && target.closest('.note-card')) return;
    const images = [...event.dataTransfer.files].filter((file) =>
      file.type.startsWith('image/'),
    );
    if (!images.length) return;
    event.preventDefault();
    event.stopPropagation();
    addCanvasImages(images, event.clientX, event.clientY);
  };

  const handlePaneClick = useCallback(() => {
    const pressOrigin = pressOriginRef.current;
    pressOriginRef.current = null;
    // Selecting text inside a note and releasing the pointer over the empty
    // pane dispatches a click on the pane. That is still part of the text
    // selection gesture, not a request to deselect the element.
    const selection = window.getSelection();
    const selectingText = Boolean(selection && selection.rangeCount > 0 && !selection.isCollapsed);
    if (pressOrigin?.insideNote || selectingText) return;
    // Precision touchpads can finish a pan with a stray click. The viewport
    // just moved, so that click belongs to the navigation gesture, not to an
    // intentional request to leave the editor.
    if (performance.now() - viewportInteractedAtRef.current < 180) return;

    clearEditZoomTimer();
    setEditingNoteId(null);
    setResizingNoteId(null);
    onDeselectNote();
  }, [clearEditZoomTimer, onDeselectNote]);

  const handleCanvasPointerDownCapture = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const target = event.target;
      pressOriginRef.current =
        target instanceof Element &&
        Boolean(
          target.closest(
            '.note-card, .note-anchored-toolbar, .note-resize-handle, .note-edge-resize, [contenteditable="true"]',
          ),
        )
          ? { insideNote: true }
          : null;
    },
    [],
  );

  const handleCanvasDoubleClick = useCallback(
    (event: ReactMouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      // Only the empty pane creates a note. Nodes, toolbars, panels, and form
      // controls keep their own double-click behaviour.
      if (!target.closest('.react-flow__pane')) return;
      if (target.closest(CANVAS_DOUBLE_CLICK_IGNORE)) return;

      event.preventDefault();
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      onCanvasEmptyNote(position, {
        anchor: { x: event.clientX, y: event.clientY },
      });
    },
    [onCanvasEmptyNote, screenToFlowPosition],
  );

  const currentSearchIndex =
    searchMatches.length > 0
      ? Math.min(activeSearchIndex, searchMatches.length - 1)
      : 0;

  return (
    <div
      className="canvas-view"
      ref={canvasRef}
      onPointerDownCapture={handleCanvasPointerDownCapture}
      onPointerMove={(event) => {
        pointerRef.current = { x: event.clientX, y: event.clientY, inside: true };
      }}
      onPointerLeave={() => {
        pointerRef.current.inside = false;
      }}
      onDoubleClick={handleCanvasDoubleClick}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <ReactFlow<NoteCanvasNode>
        nodes={nodes}
        edges={[]}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onPaneClick={handlePaneClick}
        onNodeDragStop={handleDragStop}
        onMoveStart={markViewportInteraction}
        onMoveEnd={handleMoveEnd}
        defaultViewport={canvas.viewport ?? { x: 0, y: 0, zoom: 1 }}
        minZoom={CANVAS_MIN_ZOOM}
        maxZoom={CANVAS_MAX_ZOOM}
        nodesConnectable={false}
        deleteKeyCode={null}
        nodeDragThreshold={4}
        panOnScroll
        panOnScrollSpeed={0.9}
        zoomOnScroll={false}
        zoomOnPinch={false}
        zoomOnDoubleClick={false}
        proOptions={{ hideAttribution: true }}
        fitView={false}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={22}
          size={1.1}
          color="var(--line-faint)"
        />
        <Panel position="top-right" className="canvas-fit-panel">
          <IconButton
            label="Fit canvas to view"
            size="sm"
            variant="soft"
            onClick={handleFitCanvas}
          >
            <Scan size={15} />
          </IconButton>
        </Panel>
      </ReactFlow>
      {searchOpen ? (
        <div className="canvas-search" role="search" aria-label="Find in this canvas">
          <Search size={15} className="canvas-search-icon" aria-hidden="true" />
          <input
            ref={searchInputRef}
            type="search"
            value={searchQuery}
            placeholder="Find in this canvas"
            aria-label="Find in this canvas"
            spellCheck={false}
            onChange={(event) => setSearchQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                closeCanvasSearch();
                return;
              }
              if (event.key === 'Enter') {
                event.preventDefault();
                navigateSearch(event.shiftKey ? -1 : 1);
              }
            }}
          />
          <span className="canvas-search-count" aria-live="polite">
            {searchQuery.trim()
              ? `${searchMatches.length > 0 ? currentSearchIndex + 1 : 0} of ${
                  searchMatches.length
                }`
              : ''}
          </span>
          <button
            type="button"
            className="canvas-search-button"
            aria-label="Previous match"
            title="Previous match"
            disabled={searchMatches.length === 0}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => navigateSearch(-1)}
          >
            <ChevronUp size={15} />
          </button>
          <button
            type="button"
            className="canvas-search-button"
            aria-label="Next match"
            title="Next match"
            disabled={searchMatches.length === 0}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => navigateSearch(1)}
          >
            <ChevronDown size={15} />
          </button>
          <button
            type="button"
            className="canvas-search-button canvas-search-close"
            aria-label="Close search"
            title="Close search"
            onClick={closeCanvasSearch}
          >
            <X size={15} />
          </button>
        </div>
      ) : null}
      {notes.length === 0 ? (
        <div className="canvas-empty">
          <div className="canvas-empty-icon">
            <StickyNote size={22} />
          </div>
          <h2>An empty canvas</h2>
          <p>Double-click anywhere to start writing, or paste and drop an image.</p>
          <Button variant="primary" icon={<Plus size={15} />} onClick={onAddNote}>
            Add first note
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function NoteNode({ id, data, width, dragging }: NodeProps<NoteCanvasNode>) {
  const { getNode, getViewport, setViewport } = useReactFlow<NoteCanvasNode>();
  const viewport = useViewport();
  const canvasWidth = useStore((state) => state.width);
  const canvasHeight = useStore((state) => state.height);
  const noteLayout = data.note.layout;
  const dataRef = useRef(data);
  dataRef.current = data;
  const resizeParamsRef = useRef<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const resizeStartRef = useRef<{
    width: number;
    height: number;
    heightLocked: boolean;
    widthLocked: boolean;
  } | null>(null);
  const lastEditingHeightRef = useRef<number | null>(null);
  const lastCaretFollowRef = useRef({ at: 0, shift: 0, viewportY: Number.NaN });
  const nodeX = useStore(
    (state) => state.nodeLookup.get(id)?.internals.positionAbsolute.x ?? noteLayout?.x ?? 0,
  );
  const nodeY = useStore(
    (state) => state.nodeLookup.get(id)?.internals.positionAbsolute.y ?? noteLayout?.y ?? 0,
  );
  const nodeWidth = useStore(
    (state) =>
      state.nodeLookup.get(id)?.measured.width ??
      width ??
      noteLayout?.width ??
      data.defaultNoteWidth,
  );
  const nodeHeight = useStore(
    (state) =>
      state.nodeLookup.get(id)?.measured.height ?? noteLayout?.height ?? 340,
  );

  const screenX = nodeX * viewport.zoom + viewport.x;
  const screenY = nodeY * viewport.zoom + viewport.y;
  const screenWidth = nodeWidth * viewport.zoom;
  const screenHeight = nodeHeight * viewport.zoom;
  const elementRight = screenX + screenWidth;
  const toolbarPosition =
    canvasWidth - elementRight >= TOOLBAR_WIDTH + TOOLBAR_GAP
      ? Position.Right
      : Position.Left;
  const toolbarX =
    toolbarPosition === Position.Right
      ? elementRight + TOOLBAR_GAP
      : screenX - TOOLBAR_GAP;
  // Anchor the toolbar to the part of a tall element that is actually visible
  // in the canvas. Its center then follows the current window slice rather than
  // the full element's center, which can sit far below the viewport.
  const visibleTop = Math.max(0, screenY);
  const visibleBottom = Math.min(canvasHeight, screenY + screenHeight);
  const visibleCenterY =
    visibleBottom > visibleTop
      ? (visibleTop + visibleBottom) / 2
      : screenY + screenHeight / 2;
  const toolbarY = Math.min(
    Math.max(TOOLBAR_HALF_HEIGHT, visibleCenterY),
    Math.max(TOOLBAR_HALF_HEIGHT, canvasHeight - TOOLBAR_HALF_HEIGHT),
  );
  const toolbarTransform = `translate(${toolbarX}px, ${toolbarY}px) translate(${
    toolbarPosition === Position.Right ? 0 : -100
  }%, -50%)`;
  const nodeVisible =
    screenX + screenWidth > 0 &&
    screenX < canvasWidth &&
    screenY + screenHeight > 0 &&
    screenY < canvasHeight;

  const handleResizeStart = useCallback<OnResizeStart>(
    () => {
      resizeParamsRef.current = null;
      const node = getNode(id);
      const layout = node?.data.note.layout;
      resizeStartRef.current = {
        width: Number(
          node?.measured?.width ?? node?.width ?? node?.style?.width ?? layout?.width ?? 0,
        ),
        height: Number(
          node?.measured?.height ?? node?.height ?? node?.style?.height ?? layout?.height ?? 0,
        ),
        heightLocked: Boolean(layout?.heightLocked),
        widthLocked: Boolean(layout?.widthLocked),
      };
      dataRef.current.onBeginResize(id);
    },
    [getNode, id],
  );

  const handleResize = useCallback<OnResize>((_event, params) => {
    resizeParamsRef.current = {
      x: params.x,
      y: params.y,
      width: params.width,
      height: params.height,
    };
  }, []);

  const persistResize = useCallback(
    (params: { x: number; y: number; width: number; height: number }) => {
      const node = getNode(id);
      if (!node) return;
      const current = node.data.note.layout;
      const isImage = node.data.note.kind === 'image';
      const start = resizeStartRef.current;
      resizeStartRef.current = null;
      // Text notes resize on the horizontal axis only. Their height always
      // follows the reflowed content, so a drag must never freeze it: a locked
      // height would hide everything below the old boundary. Images keep their
      // aspect-based free resize for now.
      const widthChanged = !start || Math.abs(params.width - start.width) > 0.5;
      const heightChanged = !start || Math.abs(params.height - start.height) > 0.5;
      dataRef.current.onLayoutChange(id, {
        x: params.x,
        y: params.y,
        width: params.width,
        height: params.height,
        zIndex: current?.zIndex ?? 1,
        heightLocked: isImage
          ? heightChanged || Boolean(start?.heightLocked)
          : false,
        widthLocked: widthChanged || Boolean(start?.widthLocked),
      });
    },
    [getNode, id],
  );

  const handleResizeEnd = useCallback<OnResizeEnd>(
    (_event, params) => {
      const finalParams = resizeParamsRef.current ?? params;
      resizeParamsRef.current = null;
      persistResize(finalParams);
      dataRef.current.onEndResize(id);
    },
    [id, persistResize],
  );

  /**
   * Pans the viewport just enough to keep the focused caret inside the canvas.
   * Moving the viewport leaves the note DOM untouched, unlike moving the node
   * itself, so ProseMirror keeps both its focus and its selection.
   */
  const followCaret = useCallback((): boolean => {
    const currentData = dataRef.current;
    if (!currentData.editing || currentData.note.kind === 'image') return false;
    const currentViewport = getViewport();
    const shift = caretShiftForNode(id, currentViewport.zoom);
    if (Math.abs(shift) <= 0.5) return false;

    // The height effect and a keyboard event can observe the same caret
    // position before the viewport update is painted, so apply that shift only
    // once. Repeated arrow-key moves are distinguished by the viewport moving.
    const now = performance.now();
    const last = lastCaretFollowRef.current;
    if (
      now - last.at < 48 &&
      Math.abs(last.shift - shift) < 1 &&
      Math.abs(last.viewportY - currentViewport.y) < 0.5
    ) {
      return false;
    }
    lastCaretFollowRef.current = {
      at: now,
      shift,
      viewportY: currentViewport.y,
    };

    void setViewport({
      x: currentViewport.x,
      y: currentViewport.y - shift * currentViewport.zoom,
      zoom: currentViewport.zoom,
    });
    return true;
  }, [getViewport, id, setViewport]);

  useEffect(() => {
    const currentData = dataRef.current;
    if (!currentData.editing || currentData.note.kind === 'image') {
      lastEditingHeightRef.current = null;
      lastCaretFollowRef.current = {
        at: 0,
        shift: 0,
        viewportY: Number.NaN,
      };
      return;
    }
    const node = getNode(id);
    if (!node) return;
    const height = Number(node.measured?.height ?? node.height ?? 0);
    if (!Number.isFinite(height) || height <= 0) return;

    const previousHeight = lastEditingHeightRef.current;
    lastEditingHeightRef.current = height;
    const heightChanged =
      previousHeight !== null && Math.abs(height - previousHeight) > 0.5;
    if (!heightChanged) return;

    followCaret();
  }, [followCaret, getNode, id, nodeHeight]);

  // Caret following is driven by the editor itself (see `onCaretActivity` in
  // NoteCard): ProseMirror reports every edit and selection move, which is the
  // only reliable signal inside the transformed canvas.

  return (
    <>
      {data.active && nodeVisible ? (
        <NodeToolbar
          isVisible
          position={toolbarPosition}
          align="center"
          offset={8}
          className="note-anchored-toolbar nodrag"
          style={{ transform: toolbarTransform }}
        >
          <ActiveNoteToolbar
            key={data.note.id}
            note={data.note}
            onNoteAction={data.onNoteAction}
            onInsertSelection={data.onInsertSelection}
            onFormat={data.onFormat}
          />
        </NodeToolbar>
      ) : null}
      {data.note.kind === 'image' ? (
        <>
          <NodeResizer
            isVisible={data.active}
            minWidth={280}
            minHeight={80}
            maxWidth={1200}
            maxHeight={1200}
            color="var(--accent)"
            lineClassName="note-edge-resize"
            handleClassName="note-resize-handle"
            onResizeStart={handleResizeStart}
            onResize={handleResize}
            onResizeEnd={handleResizeEnd}
          />
          {data.active
            ? (
                [
                  ['top', 'vertical'],
                  ['bottom', 'vertical'],
                ] as const
              ).map(([position, resizeDirection]) => (
                <NodeResizeControl
                  key={position}
                  position={position}
                  resizeDirection={resizeDirection}
                  className="note-resize-handle note-side-handle"
                  color="var(--accent)"
                  minWidth={280}
                  minHeight={80}
                  maxWidth={1200}
                  maxHeight={1200}
                  onResizeStart={handleResizeStart}
                  onResize={handleResize}
                  onResizeEnd={handleResizeEnd}
                />
              ))
            : null}
        </>
      ) : (
        // Text notes are width-only. A line control spans the complete left and
        // right edge, so a tall note can be resized without scrolling to a tiny
        // handle in the middle. The card reflows after every drag.
        (['left', 'right'] as const).map((position) => (
          <NodeResizeControl
            key={position}
            position={position}
            variant={ResizeControlVariant.Line}
            resizeDirection="horizontal"
            className="note-edge-resize"
            minWidth={280}
            maxWidth={1200}
            onResizeStart={handleResizeStart}
            onResize={handleResize}
            onResizeEnd={handleResizeEnd}
          />
        ))
      )}
      <NoteCard
        note={data.note}
        fontSize={data.fontSize}
        autosaveDelayMs={data.autosaveDelayMs}
        canvasZoom={viewport.zoom}
        active={data.active}
        editing={data.editing}
        resizing={data.resizing}
        dragging={dragging}
        insertion={data.insertion}
        discardWhenEmpty={data.discardWhenEmpty}
        onUpdateNote={data.onUpdateNote}
        onNoteSaveStatusChange={data.onNoteSaveStatusChange}
        onInsertionApplied={data.onInsertionApplied}
        onActivate={data.onActivate}
        onBeginEdit={data.onBeginEdit}
        onBeginResize={data.onBeginResize}
        onEditorReady={data.onEditorReady}
        onDiscardEmpty={data.onDiscardEmpty}
        onCaretActivity={followCaret}
      />
    </>
  );
}
