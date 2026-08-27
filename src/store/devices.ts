import { create } from 'zustand';

/**
 * Choix de micro, de haut-parleur et de camera.
 *
 * Separe du magasin vocal parce que ces reglages se modifient hors de tout
 * appel — c'est meme le cas le plus courant, depuis les parametres. Les
 * fusionner obligerait a charger la machinerie WebRTC pour afficher une liste
 * deroulante.
 *
 * Les identifiants d'appareils sont persistes, mais restent des voeux : un
 * casque debranche entre deux sessions rendrait l'identifiant caduc. On repasse
 * alors sur l'appareil par defaut plutot que d'echouer.
 */

export interface MediaPreferences {
  /** Identifiant du micro, ou `null` pour l'appareil par defaut du systeme. */
  microphoneId: string | null;
  speakerId: string | null;
  cameraId: string | null;

  /** Traitements du navigateur sur le micro. */
  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGainControl: boolean;

  /** Volume applique aux voix distantes, de 0 a 1. */
  outputVolume: number;
  /** Sensibilite du detecteur de parole, en dB (de -100 a 0). */
  speakingThreshold: number;

  /** Definition demandee a la camera. */
  videoQuality: '480p' | '720p' | '1080p';
  /** Definition demandee au partage d'ecran. */
  screenQuality: '720p' | '1080p' | 'source';
  /** Images par seconde du partage d'ecran. */
  screenFrameRate: 15 | 30 | 60;
}

const DEFAULTS: MediaPreferences = {
  microphoneId: null,
  speakerId: null,
  cameraId: null,
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  outputVolume: 1,
  speakingThreshold: -50,
  videoQuality: '720p',
  screenQuality: '1080p',
  screenFrameRate: 30,
};

const STORAGE_KEY = 'orbit:media';

const VIDEO_SIZES: Record<MediaPreferences['videoQuality'], { width: number; height: number }> = {
  '480p': { width: 854, height: 480 },
  '720p': { width: 1280, height: 720 },
  '1080p': { width: 1920, height: 1080 },
};

const SCREEN_SIZES: Record<MediaPreferences['screenQuality'], { width: number; height: number } | null> = {
  '720p': { width: 1280, height: 720 },
  '1080p': { width: 1920, height: 1080 },
  source: null,
};

function load(): MediaPreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<MediaPreferences>) };
  } catch {
    return DEFAULTS;
  }
}

function persist(preferences: MediaPreferences): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // Navigation privee : les reglages valent pour la session en cours.
  }
}

export interface DeviceOption {
  deviceId: string;
  label: string;
}

interface DeviceState {
  media: MediaPreferences;

  microphones: DeviceOption[];
  speakers: DeviceOption[];
  cameras: DeviceOption[];

  /** Vrai une fois l'autorisation obtenue : avant, les noms sont vides. */
  labelled: boolean;
  enumerating: boolean;
  error: string | null;

  setMedia: <K extends keyof MediaPreferences>(key: K, value: MediaPreferences[K]) => void;
  /** Recense les appareils. `prompt` demande l'autorisation pour lire les noms. */
  refreshDevices: (prompt?: boolean) => Promise<void>;
  watchDevices: () => () => void;
}

/**
 * Sans autorisation, `enumerateDevices` renvoie des entrees anonymes : le
 * nombre d'appareils est connu, pas leur nom. Une liste de « Micro », « Micro 2 »
 * serait inutilisable, d'ou la demande explicite avant le recensement.
 */
async function enumerate(prompt: boolean): Promise<{
  microphones: DeviceOption[];
  speakers: DeviceOption[];
  cameras: DeviceOption[];
  labelled: boolean;
}> {
  if (prompt) {
    // Le flux n'est demande que pour obtenir les noms : il est relache aussitot.
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop());
  }

  const devices = await navigator.mediaDevices.enumerateDevices();

  const pick = (kind: MediaDeviceKind, fallback: string): DeviceOption[] =>
    devices
      .filter((device) => device.kind === kind)
      // Sur Chrome, un appareil « default » double une entree reelle : le
      // garder afficherait deux fois le meme micro.
      .filter((device) => device.deviceId !== 'default' && device.deviceId !== 'communications')
      .map((device, index) => ({
        deviceId: device.deviceId,
        label: device.label || `${fallback} ${index + 1}`,
      }));

  return {
    microphones: pick('audioinput', 'Micro'),
    speakers: pick('audiooutput', 'Sortie'),
    cameras: pick('videoinput', 'Camera'),
    labelled: devices.some((device) => device.label !== ''),
  };
}

export const useDevices = create<DeviceState>((set, get) => ({
  media: load(),
  microphones: [],
  speakers: [],
  cameras: [],
  labelled: false,
  enumerating: false,
  error: null,

  setMedia: (key, value) => {
    const media = { ...get().media, [key]: value };
    set({ media });
    persist(media);
  },

  refreshDevices: async (prompt = false) => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices) {
      set({ error: 'Ce navigateur ne donne pas acces aux peripheriques audio et video.' });
      return;
    }

    set({ enumerating: true, error: null });

    try {
      const result = await enumerate(prompt);
      set({ ...result, enumerating: false });
    } catch (failure) {
      const denied = failure instanceof DOMException && failure.name === 'NotAllowedError';
      set({
        enumerating: false,
        error: denied
          ? "Acces au micro refuse. Autorisez-le dans la barre d'adresse pour voir vos appareils."
          : 'Impossible de lire la liste des peripheriques.',
      });
    }
  },

  /**
   * Suit les branchements a chaud. Un casque connecte pendant un appel doit
   * apparaitre sans avoir a rouvrir les parametres.
   */
  watchDevices: () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices) return () => {};

    const onChange = () => void get().refreshDevices(false);
    navigator.mediaDevices.addEventListener('devicechange', onChange);
    return () => navigator.mediaDevices.removeEventListener('devicechange', onChange);
  },
}));

/* -------------------------------------------------------------------------- */
/* Contraintes derivees                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Contraintes du micro, telles que `getUserMedia` les attend.
 *
 * `exact` sur l'appareil serait une erreur : un micro retire ferait echouer
 * l'entree en vocal au lieu de basculer sur un autre. On l'exprime donc en
 * preference.
 */
export function audioConstraints(media: MediaPreferences): MediaTrackConstraints {
  return {
    ...(media.microphoneId ? { deviceId: { ideal: media.microphoneId } } : {}),
    echoCancellation: media.echoCancellation,
    noiseSuppression: media.noiseSuppression,
    autoGainControl: media.autoGainControl,
  };
}

export function videoConstraints(media: MediaPreferences): MediaTrackConstraints {
  const size = VIDEO_SIZES[media.videoQuality];
  return {
    ...(media.cameraId ? { deviceId: { ideal: media.cameraId } } : {}),
    width: { ideal: size.width },
    height: { ideal: size.height },
    frameRate: { ideal: 30 },
  };
}

export function screenConstraints(media: MediaPreferences): MediaTrackConstraints {
  const size = SCREEN_SIZES[media.screenQuality];
  return {
    ...(size ? { width: { ideal: size.width }, height: { ideal: size.height } } : {}),
    frameRate: { ideal: media.screenFrameRate },
  };
}

/**
 * Dirige un element audio vers le haut-parleur choisi.
 *
 * `setSinkId` n'existe pas partout — Firefox le garde derriere un reglage. On
 * echoue alors en silence : la voix sort par la sortie par defaut, ce qui reste
 * preferable a une erreur remontee a l'utilisateur pour un choix secondaire.
 */
export async function applySink(element: HTMLAudioElement, speakerId: string | null): Promise<void> {
  if (!speakerId) return;

  const sinkable = element as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
  if (typeof sinkable.setSinkId !== 'function') return;

  try {
    await sinkable.setSinkId(speakerId);
  } catch {
    // Appareil disparu ou permission absente.
  }
}
