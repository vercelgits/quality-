import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/tokens.css';
import './styles/base.css';
import './styles/app.css';
// La coquille reprend les metriques de Discord ; elle vient apres app.css,
// dont elle remplace les regles de mise en page.
import './styles/shell.css';
import './styles/surfaces.css';
import './styles/features.css';
import './styles/dm.css';
import './styles/friends.css';
import './styles/settings.css';
import './styles/landing.css';
// La matiere vient apres les feuilles de structure : elle ne change que les
// surfaces, les ombres et les reponses au survol, jamais les metriques.
import './styles/depth.css';
// En dernier : les regles mobiles surchargent celles des grands ecrans.
import './styles/mobile.css';

const container = document.getElementById('root');
if (!container) throw new Error('Element racine introuvable.');

/**
 * Apercu d'un ecran isole pendant le developpement.
 *
 * `import.meta.env.DEV` est remplace par `false` a la compilation : le bloc et
 * le module qu'il importe disparaissent du paquet livre.
 */
async function root() {
  if (import.meta.env.DEV) {
    const wanted = new URLSearchParams(window.location.search).get('preview');
    if (wanted) {
      const { devPreview } = await import('./devPreview');
      const screen = devPreview(wanted);
      if (screen) return screen;
    }
  }
  return <App />;
}

void root().then((screen) => {
  createRoot(container).render(<StrictMode>{screen}</StrictMode>);
});
