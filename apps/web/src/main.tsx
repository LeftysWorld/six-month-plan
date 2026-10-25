import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { App } from './App.tsx';
import { applyTheme } from './theme.ts';
import { registerServiceWorker } from './push.ts';

applyTheme();

// The focus timer is gone; drop any timer state it left behind.
try {
  Object.keys(localStorage)
    .filter((k) => k.startsWith('six.study.'))
    .forEach((k) => localStorage.removeItem(k));
} catch {
  /* storage unavailable */
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

registerServiceWorker();
