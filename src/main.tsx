import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/tokens.css';
import './styles/base.css';
import './styles/app.css';
import './styles/surfaces.css';
import './styles/features.css';

const container = document.getElementById('root');
if (!container) throw new Error('Element racine introuvable.');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
