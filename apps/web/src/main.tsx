import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { App } from './App.tsx';
import { applyTheme } from './theme.ts';
import { registerServiceWorker } from './push.ts';

applyTheme();

// The focus timer and workout clock are gone; drop any timer state they left behind.
try {
  Object.keys(localStorage)
    .filter((k) => k.startsWith('six.study.') || k.startsWith('six.timer.'))
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
