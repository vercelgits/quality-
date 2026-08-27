import { create } from 'zustand';
import type { Session } from '@supabase/supabase-js';
import { supabase, errorMessage, isSessionFailure } from '@/lib/supabase';
import type { Profile, PresenceStatus } from '@/types/db';

/* -------------------------------------------------------------------------- */
/* Preferences d'affichage                                                     */
/* -------------------------------------------------------------------------- */

/**
 * `black` est un vrai noir, distinct de `dark` : sur un ecran OLED les pixels
 * s'eteignent vraiment. Ce n'est pas la meme demande qu'un fond sombre.
 */
export type Theme = 'light' | 'dark' | 'black' | 'system';
export type Density = 'compact' | 'cozy' | 'spacious';
export type AccentName =
  | 'indigo'
  | 'violet'
  | 'ocean'
  | 'teal'
  | 'forest'
  | 'sunset'
  | 'rose'
  | 'mono';

export interface Preferences {
  theme: Theme;
  density: Density;
  /** Teinte de base ; toute la palette en derive. */
  accent: AccentName;
  /** Coupe toutes les animations, au-dela du reglage systeme. */
  reduceMotion: boolean;
  /** Envoi du message avec Entree seule, sinon Ctrl+Entree. */
  sendOnEnter: boolean;
  /** Affiche l'heure de chaque message plutot que seulement des groupes. */
  showTimestamps: boolean;
  /**
   * Quand jouer les avatars et bannieres animes.
   *
   * `hover` par defaut, comme ailleurs : une liste de messages ou dix images
   * bougent en permanence est fatigante a lire, et coute cher en decodage.
   */
  animateAvatars: 'always' | 'hover' | 'never';
}

const DEFAULT_PREFERENCES: Preferences = {
  theme: 'system',
  density: 'cozy',
  accent: 'indigo',
  reduceMotion: false,
  sendOnEnter: true,
  showTimestamps: true,
  animateAvatars: 'hover',
};

const STORAGE_KEY = 'orbit:preferences';

function loadPreferences(): Preferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PREFERENCES;
    // Les valeurs stockees peuvent dater d'une version anterieure : on ne garde
    // que les cles connues, en repartant des valeurs par defaut.
    return { ...DEFAULT_PREFERENCES, ...(JSON.parse(raw) as Partial<Preferences>) };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

function persistPreferences(preferences: Preferences): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // Navigation privee ou stockage plein : l'application reste utilisable,
    // seules les preferences ne survivront pas au rechargement.
  }
}

/** Reporte les preferences sur l'element racine, ou le CSS les lit. */
export function applyPreferences(preferences: Preferences): void {
  const root = document.documentElement;

  if (preferences.theme === 'system') {
    root.removeAttribute('data-theme');
  } else {
    root.setAttribute('data-theme', preferences.theme);
  }

  root.setAttribute('data-density', preferences.density);
  root.setAttribute('data-accent', preferences.accent);
  root.setAttribute('data-animate', preferences.animateAvatars);

  if (preferences.reduceMotion) {
    root.setAttribute('data-motion', 'reduced');
    // Couper les transitions sans figer les images animees serait incoherent :
    // ce sont elles qui bougent le plus.
    root.setAttribute('data-animate', 'never');
  } else {
    root.removeAttribute('data-motion');
  }
}

/**
 * Recupere une erreur renvoyee dans l'adresse apres une redirection.
 *
 * Quand une connexion par fournisseur tiers echoue, Supabase ne renvoie pas
 * d'objet d'erreur : il redirige vers l'application en placant le detail dans
 * l'adresse, tantot en fragment, tantot en parametres. Sans cette lecture,
 * l'utilisateur revient sur un ecran de connexion muet, ou pire, voit passer
 * du JSON brut.
 *
 * L'adresse est nettoyee ensuite : garder l'erreur la ferait reapparaitre a
 * chaque rechargement.
 */
function readRedirectError(set: (patch: { error: string }) => void): void {
  if (typeof window === 'undefined') return;

  const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const query = new URLSearchParams(window.location.search);

  const description =
    fragment.get('error_description') ??
    query.get('error_description') ??
    fragment.get('error') ??
    query.get('error');

  if (!description) return;

  set({ error: errorMessage({ message: decodeURIComponent(description) }) });

  window.history.replaceState(null, '', window.location.pathname);
}

/* -------------------------------------------------------------------------- */
/* Etat de session                                                             */
/* -------------------------------------------------------------------------- */

interface SessionState {
  session: Session | null;
  profile: Profile | null;
  /** `true` tant que la session initiale n'a pas ete resolue. */
  loading: boolean;
  error: string | null;
  preferences: Preferences;

  initialize: () => () => void;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, username: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  requestPasswordReset: (email: string) => Promise<boolean>;
  updatePassword: (password: string) => Promise<boolean>;
  /** Vrai apres un retour depuis un lien de recuperation. */
  recovering: boolean;
  endRecovery: () => void;
  setProfile: (profile: Profile) => void;
  updateProfile: (
    patch: Partial<
      Pick<
        Profile,
        | 'display_name'
        | 'bio'
        | 'avatar_url'
        | 'banner_url'
        | 'pronouns'
        | 'links'
        | 'theme_hue'
      >
    >,
  ) => Promise<void>;
  setStatus: (status: PresenceStatus, customStatus?: string | null) => Promise<void>;
  setPreference: <K extends keyof Preferences>(key: K, value: Preferences[K]) => void;
  clearError: () => void;
}

export const useSession = create<SessionState>((set, get) => ({
  session: null,
  profile: null,
  loading: true,
  error: null,
  recovering: false,
  preferences: loadPreferences(),

  /**
   * Restaure la session existante puis suit les changements d'authentification.
   * Renvoie la fonction de desabonnement.
   */
  initialize: () => {
    applyPreferences(get().preferences);
    readRedirectError(set);

    void (async () => {
      const { data } = await supabase.auth.getSession();

      if (!data.session) {
        set({ session: null, loading: false });
        return;
      }

      // `getSession` relit le jeton stocke sans le valider. Un jeton refuse par
      // le serveur — horloge decalee au moment de la connexion, session
      // revoquee — laisserait donc l'application se croire connectee et echouer
      // sur chaque requete, sans que rien ne l'explique.
      const { error } = await supabase.auth.getUser();

      if (error && isSessionFailure(error)) {
        await supabase.auth.signOut();
        set({
          session: null,
          profile: null,
          loading: false,
          error: errorMessage(error),
        });
        return;
      }

      set({ session: data.session, loading: false });
      void get().setStatus('online');
    })();

    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      set({ session, loading: false });

      if (event === 'SIGNED_OUT') {
        set({ profile: null, recovering: false });
        return;
      }

      // Supabase ouvre une session valide au retour du lien de recuperation.
      // Sans ce drapeau, l'utilisateur atterrirait directement dans
      // l'application sans jamais choisir son nouveau mot de passe.
      if (event === 'PASSWORD_RECOVERY') {
        set({ recovering: true });
      }
    });

    return () => data.subscription.unsubscribe();
  },

  signIn: async (email, password) => {
    set({ error: null });
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      set({ error: errorMessage(error) });
      throw error;
    }
  },

  signUp: async (email, password, username) => {
    set({ error: null });
    const { error } = await supabase.auth.signUp({
      email,
      password,
      // Le declencheur `handle_new_user` lit ces metadonnees pour creer le
      // profil et l'espace de demarrage.
      options: { data: { username: username.toLowerCase(), display_name: username } },
    });
    if (error) {
      set({ error: errorMessage(error) });
      throw error;
    }
  },

  /**
   * Envoie le courriel de reinitialisation.
   *
   * La reponse est volontairement identique que l'adresse existe ou non :
   * repondre « compte inconnu » permettrait d'enumerer les inscrits.
   */
  requestPasswordReset: async (email) => {
    set({ error: null });

    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/`,
    });

    if (error) {
      set({ error: errorMessage(error) });
      return false;
    }
    return true;
  },

  updatePassword: async (password) => {
    set({ error: null });

    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      set({ error: errorMessage(error) });
      return false;
    }

    set({ recovering: false });
    return true;
  },

  endRecovery: () => set({ recovering: false }),

  /**
   * Connexion par Google.
   *
   * Le navigateur quitte la page vers Google puis revient sur `/app` avec un
   * jeton dans l'adresse ; `detectSessionInUrl` du client Supabase le consomme
   * et ouvre la session. Il n'y a donc rien a attendre ici : soit la
   * redirection part, soit elle echoue et l'on affiche pourquoi.
   */
  signInWithGoogle: async () => {
    set({ error: null });

    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/app`,
        queryParams: {
          // Redemande le choix du compte : sans cela, Google reconnecte
          // silencieusement le dernier utilise, ce qui piege qui en a plusieurs.
          prompt: 'select_account',
        },
      },
    });

    if (error) {
      set({ error: errorMessage(error) });
      throw error;
    }
  },

  signOut: async () => {
    // Le passage hors ligne est tente mais ne doit jamais empecher la
    // deconnexion elle-meme.
    try {
      await get().setStatus('offline');
    } catch {
      /* sans consequence */
    }
    await supabase.auth.signOut();
    set({ session: null, profile: null });
  },

  setProfile: (profile) => set({ profile }),

  updateProfile: async (patch) => {
    const current = get().profile;
    if (!current) return;

    // Mise a jour optimiste : l'interface reagit tout de suite, et revient en
    // arriere si la base refuse.
    set({ profile: { ...current, ...patch } });

    let { data, error } = await supabase
      .from('profiles')
      .update(patch)
      .eq('id', current.id)
      .select()
      .single();

    // Les champs de profil enrichi viennent d'une migration optionnelle. Si
    // elle n'est pas appliquee, Postgres refuse la colonne inconnue : on
    // reessaie alors avec le sous-ensemble qui existe depuis le debut, plutot
    // que de perdre aussi le nom et la biographie.
    if (error && /column .* does not exist/i.test(error.message)) {
      const fallback: Record<string, unknown> = {};
      for (const key of ['display_name', 'bio', 'avatar_url'] as const) {
        if (key in patch) fallback[key] = patch[key];
      }
      ({ data, error } = await supabase
        .from('profiles')
        .update(fallback)
        .eq('id', current.id)
        .select()
        .single());
    }

    if (error) {
      set({ profile: current, error: errorMessage(error) });
      return;
    }
    set({ profile: data as Profile });
  },

  setStatus: async (status, customStatus) => {
    const current = get().profile;
    const userId = current?.id ?? get().session?.user.id;
    if (!userId) return;

    const patch: Partial<Profile> = { status };
    if (customStatus !== undefined) patch.custom_status = customStatus;

    if (current) set({ profile: { ...current, ...patch } });
    await supabase.from('profiles').update(patch).eq('id', userId);
  },

  setPreference: (key, value) => {
    const preferences = { ...get().preferences, [key]: value };
    set({ preferences });
    persistPreferences(preferences);
    applyPreferences(preferences);
  },

  clearError: () => set({ error: null }),
}));
