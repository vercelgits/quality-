/**
 * Notifications de bureau.
 *
 * Le meme code sert au navigateur et a l'application Tauri : quand elle est
 * presente, le greffon natif est prefere parce qu'il passe par le centre de
 * notifications du systeme et survit a une fenetre reduite. Sinon on retombe
 * sur l'API Notification du navigateur.
 *
 * Rien n'est notifie tant que l'onglet est visible : recevoir une bulle pour un
 * message qu'on est en train de lire est la meilleure facon de faire couper les
 * notifications par l'utilisateur.
 */

type TauriNotification = {
  isPermissionGranted: () => Promise<boolean>;
  requestPermission: () => Promise<'granted' | 'denied' | 'default'>;
  sendNotification: (options: { title: string; body: string }) => void;
};

let tauriModule: TauriNotification | null | undefined;

/** Vrai si l'application tourne dans l'enveloppe de bureau. */
export function isDesktop(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/**
 * Charge le greffon natif a la demande.
 *
 * L'import est dynamique et enveloppe : dans un navigateur ordinaire le module
 * n'existe pas, et un import statique ferait echouer la construction du paquet.
 */
async function loadTauri(): Promise<TauriNotification | null> {
  if (tauriModule !== undefined) return tauriModule;

  if (!isDesktop()) {
    tauriModule = null;
    return null;
  }

  try {
    tauriModule = (await import('@tauri-apps/plugin-notification')) as unknown as TauriNotification;
  } catch {
    tauriModule = null;
  }
  return tauriModule;
}

export type NotificationPermissionState = 'granted' | 'denied' | 'default' | 'unsupported';

export async function permissionState(): Promise<NotificationPermissionState> {
  const native = await loadTauri();
  if (native) {
    return (await native.isPermissionGranted()) ? 'granted' : 'default';
  }

  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission as NotificationPermissionState;
}

/**
 * Demande l'autorisation.
 *
 * A n'appeler que sur un geste explicite : les navigateurs refusent, et les
 * utilisateurs detestent, une demande surgie au chargement de la page.
 */
export async function requestPermission(): Promise<NotificationPermissionState> {
  const native = await loadTauri();
  if (native) {
    return native.requestPermission();
  }

  if (typeof Notification === 'undefined') return 'unsupported';
  return (await Notification.requestPermission()) as NotificationPermissionState;
}

export interface NotifyOptions {
  title: string;
  body: string;
  /** Regroupe les notifications d'un meme salon plutot que de les empiler. */
  tag?: string;
  onClick?: () => void;
}

export async function notify({ title, body, tag, onClick }: NotifyOptions): Promise<void> {
  // Une notification pour un message deja sous les yeux est une nuisance.
  if (typeof document !== 'undefined' && document.visibilityState === 'visible') return;

  const native = await loadTauri();
  if (native) {
    if (await native.isPermissionGranted()) {
      native.sendNotification({ title, body });
    }
    return;
  }

  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;

  const notification = new Notification(title, {
    body,
    tag,
    icon: '/icon.png',
    silent: false,
  });

  notification.onclick = () => {
    window.focus();
    onClick?.();
    notification.close();
  };
}

/** Tronque un message pour qu'il tienne dans une bulle sans etre coupe net. */
export function preview(content: string, limit = 140): string {
  const flat = content.replace(/\s+/g, ' ').trim();
  if (flat.length <= limit) return flat;
  return `${flat.slice(0, limit - 1)}…`;
}
