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
    const candidate = error as {
      message?: unknown;
      msg?: unknown;
      error_description?: unknown;
    };

    // Selon le chemin emprunte, Supabase place le detail dans `message`, dans
    // `msg` (reponse brute de l'API d'authentification) ou dans
    // `error_description` (retour d'une redirection OAuth).
    for (const field of [candidate.message, candidate.msg, candidate.error_description]) {
      if (typeof field === 'string' && field.length > 0) return translate(field);
    }
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
    'Unsupported provider: provider is not enabled':
      'La connexion Google n’est pas encore activee sur ce projet. ' +
      'Activez-la dans Authentication puis Providers, cote Supabase.',
    'For security purposes, you can only request this after 60 seconds.':
      'Pour des raisons de securite, reessayez dans une minute.',
  };

  if (known[message]) return known[message];

  // Les libelles exacts changent d'une version a l'autre : on reconnait donc
  // aussi les cas courants par fragment, faute de quoi une reformulation cote
  // Supabase reviendrait a afficher de l'anglais technique.
  const lowered = message.toLowerCase();
  if (lowered.includes('provider is not enabled') || lowered.includes('unsupported provider')) {
    return (
      'La connexion Google n’est pas activee sur ce projet Supabase. ' +
      'Ouvrez Authentication puis Providers, activez Google, collez vos ' +
      'identifiants et enregistrez.'
    );
  }
  if (lowered.includes('redirect_uri_mismatch')) {
    return (
      'L’adresse de retour ne correspond pas a celle declaree chez Google. ' +
      'Verifiez l’URI de redirection autorisee, au caractere pres.'
    );
  }
  if (lowered.includes('access_denied')) {
    return 'Connexion annulee : l’acces au compte Google a ete refuse.';
  }
  if (message.includes('duplicate key') && message.includes('username')) {
    return 'Ce pseudo est deja pris.';
  }
  if (message.includes('Failed to fetch') || message.includes('NetworkError')) {
    return 'Impossible de joindre le serveur. Verifiez votre connexion, puis reessayez.';
  }
  // Message renvoye par nos fonctions quand un quota est atteint.
  if (message.includes('Trop de') || message.includes('Trop d')) {
    return message;
  }
  return message;
}
