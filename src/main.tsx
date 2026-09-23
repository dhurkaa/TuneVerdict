import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { I18nProvider } from './i18n';
import { PowerUnitProvider } from './display/powerUnit';
import './styles/tokens.css';
import './styles/base.css';

const container = document.getElementById('root');
if (!container) throw new Error('#root is missing from index.html');

createRoot(container).render(
  <StrictMode>
    <I18nProvider>
      <PowerUnitProvider>
        <App />
      </PowerUnitProvider>
    </I18nProvider>
  </StrictMode>,
);
