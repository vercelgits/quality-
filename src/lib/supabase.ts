import { createClient } from '@supabase/supabase-js';

const url = import.meta.env['VITE_SUPABASE_URL'];
const key = import.meta.env['VITE_SUPABASE_PUBLISHABLE_KEY'];

if (!url || !key) {
  throw new Error(
    'Configuration Supabase manquante. Copiez .env.example vers .env.local et ' +
      'renseignez VITE_SUPABASE_URL et VITE_SUPABASE_PUBLISHABLE_KEY.',
  );
}

/**
 * Client Supabase unique de l'application.
 *
 * La cle utilisee ici est la cle publiable : elle est faite pour vivre dans le
 * navigateur. Ce qui protege les donnees, ce n'est pas son secret mais les
 * politiques RLS definies dans `supabase/migrations`. Toute regle d'acces doit
 * donc etre exprimee en SQL, jamais uniquement dans ce code : un client peut
 * toujours etre contourne.
 */
export const supabase = createClient(url, key, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
  realtime: {
    params: {
      // Plafond de messages par seconde ; au-dela, Realtime applique un delai.
      eventsPerSecond: 20,
    },
  },
  global: {
    headers: { 'x-client-info': 'orbit-web' },
  },
});

/** Message d'erreur lisible a partir de ce que renvoie Supabase. */
export function errorMessage(error: unknown): string {
  if (!error) return 'Une erreur inconnue est survenue.';

  if (typeof error === 'object' && error !== null) {
    const candidate = error as { message?: unknown; error_description?: unknown };
    const raw =
      typeof candidate.message === 'string'
        ? candidate.message
        : typeof candidate.error_description === 'string'
          ? candidate.error_description
          : null;

    if (raw) return translate(raw);
  }

  return String(error);
}

/** Traduit les messages d'erreur les plus courants de Supabase Auth. */
function translate(message: string): string {
  const known: Record<string, string> = {
    'Invalid login credentials': 'Identifiants incorrects.',
    'User already registered': 'Un compte existe deja avec cette adresse.',
    'Email not confirmed': "Adresse e-mail non confirmee. Verifiez votre boite de reception.",
    'Password should be at least 6 characters':
      'Le mot de passe doit faire au moins 6 caracteres.',
    'Unable to validate email address: invalid format': 'Adresse e-mail invalide.',
    'For security purposes, you can only request this after 60 seconds.':
      'Pour des raisons de securite, reessayez dans une minute.',
  };

  if (known[message]) return known[message];
  if (message.includes('duplicate key') && message.includes('username')) {
    return 'Ce pseudo est deja pris.';
  }
  if (message.includes('Failed to fetch')) {
    return 'Impossible de joindre le serveur. Verifiez votre connexion.';
  }
  return message;
}
