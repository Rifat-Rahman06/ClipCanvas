import { useCallback, useEffect, useRef } from 'react';
import type { Viewport } from '@xyflow/react';
import type { Editor } from '@tiptap/react';
import { TextSelection } from '@tiptap/pm/state';
import { selectionScrollStep } from '../lib/selectionScroll';

/** Pointer travel needed before a press becomes a selection drag. */
const DRAG_THRESHOLD_PX = 4;
const FRAME_MS = 1000 / 60;

interface PointerPosition {
  x: number;
  y: number;
}

interface SelectionSession {
  editor: Editor;
  startX: number;
  startY: number;
  pointer: PointerPosition;
  /** The press has travelled far enough to be a text-selection drag. */
  dragging: boolean;
  /** Document position where the drag started. */
  anchor: number | null;
  /** The canvas has actually been panned at least once in this session. */
  scrolled: boolean;
  frame: number;
  lastFrameAt: number;
  cleanup: () => void;
}

interface SelectionAutoScrollOptions {
  getViewport: () => Viewport;
  setViewport: (viewport: Viewport) => void;
  getCanvasRect: () => DOMRect | null;
  /** Called before the first frame that pans the canvas. */
  onScrollStart?: () => void;
  /** Called once the session ends, only if it panned the canvas. */
  onScrollEnd?: () => void;
}

export interface SelectionAutoScrollHandle {
  begin: (editor: Editor, pointer: PointerPosition) => void;
  stop: () => void;
}

/**
 * Extends the editor selection to the pointer after the canvas has moved. The
 * browser cannot do this on its own: panning moves the note's content under a
 * stationary pointer, which produces no native mousemove to extend the
 * selection.
 */
function extendSelectionToPointer(
  editor: Editor,
  anchor: number,
  pointer: PointerPosition,
  canvasRect: DOMRect,
  contentRect: DOMRect,
  direction: 1 | -1,
): void {
  if (editor.isDestroyed) return;
  const doc = editor.state.doc;
  const left = Math.min(
    Math.max(pointer.x, contentRect.left + 2),
    contentRect.right - 2,
  );
  const top = Math.min(
    Math.max(pointer.y, canvasRect.top + 2),
    canvasRect.bottom - 2,
  );
  let head: number | null = null;

  try {
    const hit = editor.view.posAtCoords({ left, top });
    if (hit) head = hit.pos;
    if (head === null) head = direction > 0 ? doc.content.size : 0;
    const next = TextSelection.between(doc.resolve(anchor), doc.resolve(head));
    if (editor.state.selection.eq(next)) return;
    // Selection-only transactions never add history steps or scroll the view,
    // so the drag anchor and the note's focus are preserved.
    editor.view.dispatch(editor.state.tr.setSelection(next));
  } catch {
    // Positions can become invalid if the document changed mid-drag.
  }
}

/**
 * Pans the canvas vertically while text is being selected near the top or
 * bottom edge, so a long note can be selected beyond the visible area without
 * releasing the mouse button. The native mouse selection inside the editor is
 * left untouched until panning starts.
 */
export function useSelectionAutoScroll(
  options: SelectionAutoScrollOptions,
): SelectionAutoScrollHandle {
  const sessionRef = useRef<SelectionSession | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const stop = useCallback(() => {
    const session = sessionRef.current;
    if (!session) return;
    sessionRef.current = null;
    window.cancelAnimationFrame(session.frame);
    session.cleanup();
    if (session.scrolled) optionsRef.current.onScrollEnd?.();
  }, []);

  const begin = useCallback(
    (editor: Editor, pointer: PointerPosition) => {
      if (editor.isDestroyed) return;
      stop();
      const session: SelectionSession = {
        editor,
        startX: pointer.x,
        startY: pointer.y,
        pointer: { ...pointer },
        dragging: false,
        anchor: null,
        scrolled: false,
        frame: 0,
        lastFrameAt: 0,
        cleanup: () => {},
      };

      // Resolve the press position immediately: ProseMirror's selection may not
      // have caught up with the native caret yet, but the drag anchor must be
      // the point where the button went down.
      try {
        const hit = editor.view.posAtCoords({ left: pointer.x, top: pointer.y });
        session.anchor = hit ? hit.pos : editor.state.selection.anchor;
      } catch {
        session.anchor = editor.state.selection.anchor;
      }

      const handlePointerMove = (event: PointerEvent) => {
        if (sessionRef.current !== session) return;
        if (event.pointerType === 'touch' || (event.buttons & 1) === 0) {
          stop();
          return;
        }
        session.pointer = { x: event.clientX, y: event.clientY };
        if (session.dragging) return;
        const dx = event.clientX - session.startX;
        const dy = event.clientY - session.startY;
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
        session.dragging = true;
      };

      const handlePointerUp = () => stop();
      const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Escape') stop();
      };

      session.cleanup = () => {
        window.removeEventListener('pointermove', handlePointerMove, true);
        window.removeEventListener('pointerup', handlePointerUp, true);
        window.removeEventListener('pointercancel', handlePointerUp, true);
        window.removeEventListener('blur', handlePointerUp);
        window.removeEventListener('keydown', handleKeyDown, true);
      };

      window.addEventListener('pointermove', handlePointerMove, true);
      window.addEventListener('pointerup', handlePointerUp, true);
      window.addEventListener('pointercancel', handlePointerUp, true);
      window.addEventListener('blur', handlePointerUp);
      window.addEventListener('keydown', handleKeyDown, true);

      sessionRef.current = session;

      const tick = () => {
        if (sessionRef.current !== session) return;
        session.frame = window.requestAnimationFrame(tick);
        if (editor.isDestroyed || !editor.isEditable || !editor.view.dom.isConnected) {
          stop();
          return;
        }
        if (!session.dragging || session.anchor === null) {
          session.lastFrameAt = 0;
          return;
        }

        const canvasRect = optionsRef.current.getCanvasRect();
        if (!canvasRect) {
          stop();
          return;
        }
        const contentRect = editor.view.dom.getBoundingClientRect();
        const step = selectionScrollStep({
          pointerY: session.pointer.y,
          viewportTop: canvasRect.top,
          viewportBottom: canvasRect.bottom,
          contentTop: contentRect.top,
          contentBottom: contentRect.bottom,
        });
        if (step === 0) {
          session.lastFrameAt = 0;
          return;
        }

        const now = performance.now();
        const elapsed =
          session.lastFrameAt > 0 ? now - session.lastFrameAt : FRAME_MS;
        session.lastFrameAt = now;
        // Clamp the frame multiplier so a stalled tab cannot jump the canvas.
        const delta =
          step * Math.min(2, Math.max(0.25, elapsed / FRAME_MS));

        if (!session.scrolled) {
          // The flag must be set before `setViewport`, whose move callbacks
          // fire synchronously, so the transient pans are not persisted.
          session.scrolled = true;
          optionsRef.current.onScrollStart?.();
        }

        const viewport = optionsRef.current.getViewport();
        optionsRef.current.setViewport({
          x: viewport.x,
          y: viewport.y - delta,
          zoom: viewport.zoom,
        });

        extendSelectionToPointer(
          editor,
          session.anchor,
          session.pointer,
          canvasRect,
          editor.view.dom.getBoundingClientRect(),
          delta > 0 ? 1 : -1,
        );
      };

      session.frame = window.requestAnimationFrame(tick);
    },
    [stop],
  );

  useEffect(() => stop, [stop]);

  return { begin, stop };
}
