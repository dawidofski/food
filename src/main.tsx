import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
import { registerSW } from 'virtual:pwa-register';
import { updates } from './state/updates';
import { applyTheme, watchSystemTheme } from './state/theme';

// The inline script in index.html already chose the theme; this keeps System in step with the device.
applyTheme();
watchSystemTheme();

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
