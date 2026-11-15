import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter/wght.css';
import '@fontsource-variable/source-serif-4/wght.css';
import '../styles/tokens.css';
import '../styles/base.css';
import '../styles/toast.css';
import '../styles/popup.css';
import { PopupApp } from './PopupApp';
import { applyTheme, readStoredTheme } from '../lib/theme';
import { NotebookProvider } from '../state/NotebookContext';
import { ToastProvider } from '../state/ToastContext';

const container = document.getElementById('root');

if (!container) {
  throw new Error('ClipCanvas could not find its popup root element.');
}

applyTheme(readStoredTheme());

createRoot(container).render(
  <StrictMode>
    <ToastProvider>
      <NotebookProvider>
        <PopupApp />
      </NotebookProvider>
    </ToastProvider>
  </StrictMode>,
);
