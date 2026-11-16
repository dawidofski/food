import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
import { registerSW } from 'virtual:pwa-register';
import { updates } from './state/updates';

const root = document.getElementById('root');
if (!root) throw new Error('Root element #root not found');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Offline support. A new version is applied only when nothing is half-entered (see state/updates.ts).
const updateSW = registerSW({ onNeedRefresh: () => updates.notifyReady() });
updates.setApply(() => void updateSW(true));
