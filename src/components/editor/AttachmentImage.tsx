import { Node, mergeAttributes } from '@tiptap/core';
import {
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from '@tiptap/react';
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { ImageOff } from 'lucide-react';
import { getAttachmentUrl } from '../../services/db/attachments';

export const AttachmentImage = Node.create({
  name: 'attachmentImage',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      attachmentId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-attachment-id'),
        renderHTML: (attributes) =>
          attributes.attachmentId
            ? { 'data-attachment-id': attributes.attachmentId as string }
            : {},
      },
      src: {
        default: null,
        parseHTML: (element) => element.getAttribute('src'),
        renderHTML: (attributes) =>
          !attributes.attachmentId && attributes.src ? { src: attributes.src as string } : {},
      },
      alt: {
        default: null,
        parseHTML: (element) => element.getAttribute('alt'),
        renderHTML: (attributes) => (attributes.alt ? { alt: attributes.alt as string } : {}),
      },
      width: {
        default: null,
        parseHTML: (element) => {
          const value = Number(element.getAttribute('width'));
          return Number.isFinite(value) && value > 0 ? value : null;
        },
        renderHTML: (attributes) =>
          attributes.width ? { width: String(attributes.width) } : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: 'img[data-attachment-id]' }, { tag: 'img[src]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['img', mergeAttributes(HTMLAttributes)];
  },

  addNodeView() {
    return ReactNodeViewRenderer(AttachmentImageView);
  },
});

function AttachmentImageView({ node, selected, updateAttributes }: NodeViewProps) {
  const attachmentId = node.attrs.attachmentId as string | null;
  const remoteSrc = node.attrs.src as string | null;
  const alt = (node.attrs.alt as string | null) || 'Pasted image';
  const width = node.attrs.width as number | null;
  const [resolvedSrc, setResolvedSrc] = useState<string | null>(remoteSrc);
  const [loading, setLoading] = useState(Boolean(attachmentId && !remoteSrc));
  const [missing, setMissing] = useState(false);
  const imageRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    let cancelled = false;
    if (!attachmentId) {
      setResolvedSrc(remoteSrc);
      setLoading(false);
      setMissing(!remoteSrc);
      return;
    }
    setLoading(!remoteSrc);
    void getAttachmentUrl(attachmentId).then((url) => {
      if (cancelled) return;
      setResolvedSrc(url);
      setLoading(false);
      setMissing(!url);
    });
    return () => {
      cancelled = true;
    };
  }, [attachmentId, remoteSrc]);

  const handleResizeStart = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth =
      width ?? imageRef.current?.getBoundingClientRect().width ?? 360;
    const onMove = (moveEvent: PointerEvent) => {
      const next = Math.min(1200, Math.max(140, startWidth + moveEvent.clientX - startX));
      updateAttributes({ width: Math.round(next) });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <NodeViewWrapper
      className={`clipcanvas-image-node${selected ? ' is-selected' : ''}`}
      data-drag-handle
    >
      {loading ? (
        <div className="clipcanvas-image-loading" aria-hidden="true" />
      ) : missing || !resolvedSrc ? (
        <div className="clipcanvas-image-missing">
          <ImageOff size={18} />
          <span>Image unavailable</span>
        </div>
      ) : (
        <img
          ref={imageRef}
          src={resolvedSrc}
          alt={alt}
          draggable={false}
          style={{ width: width ? `${width}px` : undefined }}
          onError={() => setMissing(true)}
        />
      )}
      <button
        type="button"
        className="clipcanvas-image-resize"
        aria-label="Resize image"
        onPointerDown={handleResizeStart}
      />
    </NodeViewWrapper>
  );
}
