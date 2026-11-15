import { THEME_DEFAULT, type ThemeMode } from '../types';

/** Mirrors the saved setting so the first paint can pick the right palette. */
const THEME_STORAGE_KEY = 'clipcanvas.theme';

function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'light' || value === 'dark';
}

export function readStoredTheme(): ThemeMode {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (isThemeMode(stored)) return stored;
  } catch {
    // Storage can be unavailable; the in-memory default still works.
  }
  return THEME_DEFAULT;
}

export function applyTheme(theme: ThemeMode): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (root.dataset.theme !== theme) root.dataset.theme = theme;
  root.style.colorScheme = theme;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // The theme still applies for this session even if it cannot be mirrored.
  }
}
