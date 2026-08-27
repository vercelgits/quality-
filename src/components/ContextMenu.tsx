import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Menu contextuel, ouvert au clic droit ou au clavier.
 *
 * Rendu dans un portail attache au corps du document : un menu rendu a sa
 * place dans l'arbre serait rogne par le premier parent qui masque son
 * debordement — et il y en a partout, la liste des messages comme la barre
 * laterale defilent toutes les deux.
 *
 * Il se replace de lui-meme quand il depasserait la fenetre : ouvert pres du
 * bord droit, il bascule a gauche du curseur plutot que de sortir de l'ecran.
 */

export interface MenuItem {
  id: string;
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  /** Rouge, pour ce qui retire ou bloque. */
  danger?: boolean;
  disabled?: boolean;
}

/** Un separateur entre deux groupes d'actions. */
export type MenuEntry = MenuItem | { id: string; separator: true };

function isSeparator(entry: MenuEntry): entry is { id: string; separator: true } {
  return 'separator' in entry;
}

export interface MenuPosition {
  x: number;
  y: number;
}

export function ContextMenu({
  position,
  entries,
  onClose,
  label,
}: {
  position: MenuPosition;
  entries: MenuEntry[];
  onClose: () => void;
  label: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState(position);

  // Mesure avant peinture : corriger la position dans un `useEffect` laisserait
  // voir le menu sauter d'un coin a l'autre.
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;

    const { width, height } = node.getBoundingClientRect();
    const marge = 8;

    setPlacement({
      x: Math.min(position.x, window.innerWidth - width - marge),
      y: Math.min(position.y, window.innerHeight - height - marge),
    });
  }, [position.x, position.y, entries.length]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };

    // `pointerdown` plutot que `click` : le menu doit se fermer des l'appui,
    // sinon un clic ailleurs le referme apres avoir active ce qu'il y avait
    // dessous, ce qui donne l'impression d'un decalage.
    const onPointer = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };

    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onPointer, true);
    // Le menu suit le curseur, pas le contenu : le laisser ouvert pendant un
    // defilement le detacherait de ce qu'il designe.
    window.addEventListener('scroll', onClose, true);
    window.addEventListener('resize', onClose);

    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onPointer, true);
      window.removeEventListener('scroll', onClose, true);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  // Le premier element prend le focus : le menu est alors utilisable aux
  // fleches sans toucher a la souris.
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }, []);

  const onArrows = (event: React.KeyboardEvent) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();

    const boutons = [...(ref.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
    if (boutons.length === 0) return;

    const index = boutons.indexOf(document.activeElement as HTMLButtonElement);
    const pas = event.key === 'ArrowDown' ? 1 : -1;
    // Le parcours boucle : arrive en bas, la fleche suivante revient en haut.
    boutons[(index + pas + boutons.length) % boutons.length]?.focus();
  };

  return createPortal(
    <div
      ref={ref}
      className="ctx-menu"
      role="menu"
      aria-label={label}
      style={{ left: placement.x, top: placement.y }}
      onKeyDown={onArrows}
    >
      {entries.map((entry) =>
        isSeparator(entry) ? (
          <hr key={entry.id} className="ctx-menu__rule" />
        ) : (
          <button
            key={entry.id}
            type="button"
            role="menuitem"
            className={'ctx-menu__item' + (entry.danger ? ' is-danger' : '')}
            disabled={entry.disabled}
            onClick={() => {
              entry.onSelect();
              onClose();
            }}
          >
            {entry.icon ? <span className="ctx-menu__icon">{entry.icon}</span> : null}
            {entry.label}
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}

/**
 * Etat d'ouverture d'un menu contextuel.
 *
 * Regroupe ici parce que chaque appelant repeterait sinon les memes trois
 * lignes — position, ouverture, fermeture — et oublierait le `preventDefault`
 * qui empeche le menu du navigateur de s'afficher par-dessus le notre.
 */
export function useContextMenu() {
  const [position, setPosition] = useState<MenuPosition | null>(null);

  return {
    position,
    close: () => setPosition(null),
    /** A brancher sur `onContextMenu`. */
    open: (event: React.MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      setPosition({ x: event.clientX, y: event.clientY });
    },
    /** Ouvre au centre d'un element : pour un declenchement au clavier. */
    openAt: (element: HTMLElement | null) => {
      if (!element) return;
      const box = element.getBoundingClientRect();
      setPosition({ x: box.left, y: box.bottom + 4 });
    },
  };
}
