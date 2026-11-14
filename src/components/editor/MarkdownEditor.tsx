import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';

interface MarkdownEditorProps {
  value: string;
  placeholder?: string;
  onChange: (markdown: string) => void;
  onFocus: () => void;
  onBlur: () => void;
}

/**
 * Edit-mode surface: the note's canonical Markdown source, shown verbatim so it
 * can be edited directly. It grows with its content, matching the preview's
 * height so the card does not jump around while typing.
 */
export function MarkdownEditor({
  value,
  placeholder,
  onChange,
  onFocus,
  onBlur,
}: MarkdownEditorProps) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const resize = useCallback(() => {
    const element = ref.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${element.scrollHeight}px`;
  }, []);

  // `useLayoutEffect` keeps the height correct in the same paint as the text,
  // so the canvas does not flash a scrollbar while typing.
  useLayoutEffect(() => {
    resize();
  }, [resize, value]);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const timer = window.setTimeout(() => {
      element.focus({ preventScroll: true });
      resize();
    }, 30);
    return () => window.clearTimeout(timer);
  }, [resize]);

  return (
    <textarea
      ref={ref}
      className="note-markdown-input"
      value={value}
      placeholder={placeholder}
      spellCheck
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="off"
      aria-label="Markdown source"
      onChange={(event) => {
        onChange(event.target.value);
        resize();
      }}
      onFocus={onFocus}
      onBlur={onBlur}
    />
  );
}
