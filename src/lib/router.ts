import { useCallback, useSyncExternalStore } from 'react';

/**
 * Routeur minimal.
 *
 * L'application n'a que trois surfaces publiques : la presentation, la
 * connexion, et l'application elle-meme. Une bibliotheque de routage
 * apporterait ici un chargeur de routes, des routes imbriquees et un systeme de
 * parametres dont rien n'a besoin, pour une trentaine de kilo-octets.
 *
 * `useSyncExternalStore` s'abonne au moment ou React lit la valeur : aucune
 * fenetre ne subsiste entre le premier rendu et l'abonnement pendant laquelle
 * un retour arriere passerait inapercu.
 */

export type Route = '/' | '/connexion' | '/app';

const KNOWN: Route[] = ['/', '/connexion', '/app'];

function currentPath(): Route {
  const path = window.location.pathname;
  return (KNOWN.find((route) => route === path) ?? '/') as Route;
}

const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

// `popstate` couvre les boutons precedent et suivant ; `navigate` publie nos
// propres changements, que `pushState` ne signale pas.
if (typeof window !== 'undefined') {
  window.addEventListener('popstate', notify);
}

export function navigate(route: Route, options: { replace?: boolean } = {}): void {
  if (currentPath() === route) return;

  if (options.replace) window.history.replaceState(null, '', route);
  else window.history.pushState(null, '', route);

  notify();
  window.scrollTo(0, 0);
}

export function useRoute(): { route: Route; go: (route: Route) => void } {
  const route = useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    currentPath,
    () => '/' as Route,
  );

  const go = useCallback((next: Route) => navigate(next), []);

  return { route, go };
}
