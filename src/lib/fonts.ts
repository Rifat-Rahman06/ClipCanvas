/**
 * Curated typefaces for note text. Web fonts are self-hosted through
 * Fontsource so the editor keeps working offline inside the extension;
 * Arial, Aptos, Calibri, Helvetica, and Georgia use the platform fonts.
 * `stack` is written directly into the `--font-note` custom property.
 */
export const EDITOR_FONT_FAMILIES = [
  {
    id: 'inter',
    label: 'Inter',
    stack: "'Inter Variable', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
  },
  {
    id: 'arial',
    label: 'Arial',
    stack: "Arial, 'Helvetica Neue', Helvetica, sans-serif",
  },
  {
    id: 'aptos',
    label: 'Aptos',
    stack: "'Aptos', 'Aptos Display', Calibri, 'Segoe UI', Arial, sans-serif",
  },
  {
    id: 'roboto',
    label: 'Roboto',
    stack: "'Roboto', Arial, 'Segoe UI', sans-serif",
  },
  {
    id: 'calibri',
    label: 'Calibri',
    stack: "Calibri, 'Segoe UI', Arial, sans-serif",
  },
  {
    id: 'helvetica',
    label: 'Helvetica',
    stack: "Helvetica, 'Helvetica Neue', Arial, sans-serif",
  },
  {
    id: 'source-sans-3',
    label: 'Source Sans 3',
    stack: "'Source Sans 3', 'Source Sans Pro', 'Segoe UI', Arial, sans-serif",
  },
  {
    id: 'open-sans',
    label: 'Open Sans',
    stack: "'Open Sans', 'Segoe UI', Arial, sans-serif",
  },
  {
    id: 'lato',
    label: 'Lato',
    stack: "'Lato', 'Segoe UI', Arial, sans-serif",
  },
  {
    id: 'georgia',
    label: 'Georgia',
    stack: "Georgia, 'Times New Roman', serif",
  },
  {
    id: 'nunito',
    label: 'Nunito',
    stack: "'Nunito', 'Segoe UI', Arial, sans-serif",
  },
] as const;

export type EditorFontFamily = (typeof EDITOR_FONT_FAMILIES)[number]['id'];

export const EDITOR_FONT_FAMILY_DEFAULT: EditorFontFamily = 'inter';

export function isEditorFontFamily(value: unknown): value is EditorFontFamily {
  return (
    typeof value === 'string' && EDITOR_FONT_FAMILIES.some((font) => font.id === value)
  );
}

export function editorFontStack(id: EditorFontFamily): string {
  return (
    EDITOR_FONT_FAMILIES.find((font) => font.id === id)?.stack ??
    EDITOR_FONT_FAMILIES[0].stack
  );
}

/** Applies the saved typeface without touching any other part of the palette. */
export function applyEditorFontFamily(id: EditorFontFamily): void {
  if (typeof document === 'undefined') return;
  document.documentElement.style.setProperty('--font-note', editorFontStack(id));
}
