import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter/wght.css';
import '@fontsource-variable/source-serif-4/wght.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/shell.css';
import './styles/editor.css';
import './styles/canvas.css';
import './styles/views.css';
import './styles/dialogs.css';
import './styles/toast.css';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { NotebookProvider } from './state/NotebookContext';
import { ToastProvider } from './state/ToastContext';

const container = document.getElementById('root');

if (!container) {
  throw new Error('ClipCanvas could not find its root element.');
}

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary>
      <ToastProvider>
        <NotebookProvider>
          <App />
        </NotebookProvider>
      </ToastProvider>
    </ErrorBoundary>
  </StrictMode>,
);
