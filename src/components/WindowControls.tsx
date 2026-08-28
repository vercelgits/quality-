import { useEffect, useState } from 'react';
import { Icon } from './Icon';

/**
 * Commandes de fenetre integrees a l'application.
 *
 * La barre de titre du systeme est desactivee (`decorations: false`) : elle
 * imposait un bandeau gris au-dessus d'une interface sombre, avec ses propres
 * coins carres par-dessus les notres. On la redessine donc ici, dans l'en-tete,
 * avec le reste.
 *
 * En echange, deux choses reviennent a notre charge :
 *  - deplacer la fenetre, confie a `data-tauri-drag-region` sur l'en-tete ;
 *  - les boutons ci-dessous.
 *
 * Le composant ne rend rien hors du bureau : sur le web, la fenetre appartient
 * au navigateur.
 */

const DANS_TAURI = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/*
 * macOS garde ses propres pastilles.
 *
 * Le systeme les dessine lui-meme, en haut a gauche, et la fenetre est
 * configuree pour qu'elles flottent sur le contenu — `titleBarStyle: Overlay`.
 * En redessiner trois autres a droite donnerait six boutons pour trois
 * actions, dont trois au mauvais endroit pour qui utilise un Mac.
 */
const SUR_MAC =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent);

export function WindowControls() {
  const [agrandie, setAgrandie] = useState(false);

  useEffect(() => {
    if (!DANS_TAURI || SUR_MAC) return;
    let annule = false;
    let detacher: (() => void) | undefined;

    void (async () => {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const fenetre = getCurrentWindow();

      setAgrandie(await fenetre.isMaximized());
      if (annule) return;

      // Le double-clic sur la zone de deplacement, et le glisser vers le haut,
      // agrandissent la fenetre sans passer par nos boutons : l'icone doit
      // suivre, sinon elle propose de restaurer une fenetre qui ne l'est pas.
      const arret = await fenetre.onResized(() => {
        void fenetre.isMaximized().then((valeur) => {
          if (!annule) setAgrandie(valeur);
        });
      });

      if (annule) arret();
      else detacher = arret;
    })();

    return () => {
      annule = true;
      detacher?.();
    };
  }, []);

  if (!DANS_TAURI || SUR_MAC) return null;

  const agir = (action: 'reduire' | 'basculer' | 'fermer') => {
    void (async () => {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const fenetre = getCurrentWindow();

        if (action === 'reduire') await fenetre.minimize();
        else if (action === 'fermer') await fenetre.close();
        else await fenetre.toggleMaximize();
      } catch (cause) {
        /*
         * Un refus doit s'entendre.
         *
         * Ces appels passent par le systeme de permissions de Tauri : sans la
         * capacite correspondante, la promesse est rejetee et il ne se passe
         * rien du tout. Le bouton parait casse, et rien n'indique ou chercher —
         * c'est exactement ce qui est arrive a « Fermer » et « Agrandir »,
         * accordees nulle part pendant que « Reduire » l'etait.
         */
        console.error(`Commande de fenetre refusee (${action}) :`, cause);
      }
    })();
  };

  return (
    <div className="window-controls">
      <button
        type="button"
        className="window-control"
        onClick={() => agir('reduire')}
        aria-label="Reduire la fenetre"
        title="Reduire"
      >
        <svg viewBox="0 0 10 10" aria-hidden="true">
          <path d="M0 5h10" />
        </svg>
      </button>

      <button
        type="button"
        className="window-control"
        onClick={() => agir('basculer')}
        aria-label={agrandie ? 'Restaurer la fenetre' : 'Agrandir la fenetre'}
        title={agrandie ? 'Restaurer' : 'Agrandir'}
      >
        {agrandie ? (
          <svg viewBox="0 0 10 10" aria-hidden="true">
            <path d="M2.5 2.5V0.5h7v7h-2" />
            <path d="M0.5 2.5h7v7h-7Z" />
          </svg>
        ) : (
          <svg viewBox="0 0 10 10" aria-hidden="true">
            <path d="M0.5 0.5h9v9h-9Z" />
          </svg>
        )}
      </button>

      <button
        type="button"
        className="window-control window-control--close"
        onClick={() => agir('fermer')}
        aria-label="Fermer la fenetre"
        title="Fermer"
      >
        <Icon name="x" size={14} />
      </button>
    </div>
  );
}
