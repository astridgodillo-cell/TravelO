import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './index.css';
import App from './App.jsx';
import { AuthProvider } from './context/AuthContext';
import ErrorBoundary from './components/ErrorBoundary';

// Avant impression, on ouvre tous les <details> (moments du planning, etc.)
// pour qu'ils s'imprime entièrement déroulés. Après impression, on rétablit.
if (typeof window !== 'undefined') {
  const restore = new WeakMap();
  window.addEventListener('beforeprint', () => {
    document.querySelectorAll('details').forEach((el) => {
      restore.set(el, el.open);
      el.open = true;
    });
  });
  window.addEventListener('afterprint', () => {
    document.querySelectorAll('details').forEach((el) => {
      if (restore.has(el)) el.open = restore.get(el);
    });
  });
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>
);
