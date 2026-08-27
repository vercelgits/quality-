import { useSyncExternalStore } from 'react';

/**
 * Suit une media query depuis React.
 *
 * `useSyncExternalStore` plutot qu'un `useState` double d'un `useEffect` :
 * l'abonnement se fait au moment ou React lit la valeur, donc il n'existe
 * aucune fenetre entre le premier rendu et l'abonnement pendant laquelle un
 * changement de taille passerait inapercu.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
    // Valeur cote serveur : sans rendu prealable, on suppose un grand ecran.
    () => false,
  );
}

/** Seuil unique, partage entre le CSS et le TypeScript. */
export const MOBILE_QUERY = '(max-width: 860px)';

export function useIsMobile(): boolean {
  return useMediaQuery(MOBILE_QUERY);
}
