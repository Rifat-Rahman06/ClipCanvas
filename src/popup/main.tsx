import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter/wght.css';
import '@fontsource-variable/source-serif-4/wght.css';
import '../styles/tokens.css';
import '../styles/base.css';
import '../styles/toast.css';
import '../styles/popup.css';
import { PopupApp } from './PopupApp';
import { NotebookProvider } from '../state/NotebookContext';
import { ToastProvider } from '../state/ToastContext';

const container = document.getElementById('root');

if (!container) {
  throw new Error('ClipCanvas could not find its popup root element.');
}

createRoot(container).render(
  <StrictMode>
    <ToastProvider>
      <NotebookProvider>
        <PopupApp />
      </NotebookProvider>
    </ToastProvider>
  </StrictMode>,
);
