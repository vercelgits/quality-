/** Limites et constantes partagees. */

export const LIMITS = {
  messageLength: 4000,
  threadTitleLength: 120,
  usernameLength: 32,
  displayNameLength: 48,
  customStatusLength: 128,
  spaceNameLength: 64,
  channelNameLength: 48,
  topicLength: 512,
  attachmentBytes: 25 * 1024 * 1024,
  attachmentsPerMessage: 10,
  messagePageSize: 50,
  searchPageSize: 25,
} as const;

/** Palette d'accents assignee de maniere deterministe aux utilisateurs et espaces. */
export const ACCENTS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#f43f5e',
  '#f97316', '#eab308', '#22c55e', '#14b8a6',
  '#06b6d4', '#3b82f6',
] as const;

/**
 * Rampe de gris utilisee a la place des accents colores.
 *
 * Huit paliers de luminosite suffisent a distinguer les personnes d'un coup
 * d'oeil sans introduire de teinte. Les valeurs sont choisies pour rester
 * lisibles sur fond clair comme sur fond sombre : ce sont des gris medians,
 * jamais les extremes de l'echelle.
 */
const MONO_STEPS = [30, 38, 46, 54, 62, 70, 78, 86] as const;

function hashOf(seed: string): number {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

/**
 * Couleur stable derivee d'un identifiant.
 *
 * La teinte fait le tour du cercle chromatique, mais luminosite et chroma
 * restent fixes : deux personnes ont donc des couleurs distinctes et de meme
 * intensite percue, sans qu'aucune ne ressorte plus que les autres.
 */
export function hueFor(seed: string): string {
  return `oklch(66% 0.19 ${hashOf(seed) % 360})`;
}

/** Gris stable derive d'un identifiant. */
export function monoFor(seed: string): string {
  return `oklch(${MONO_STEPS[hashOf(seed) % MONO_STEPS.length]}% 0 0)`;
}

/**
 * Encre a poser sur `monoFor(seed)`.
 *
 * Le seuil suit la luminosite du fond plutot qu'une valeur fixe : au-dessus de
 * 58 % on ecrit en noir, en dessous en blanc. Sans cela, les gris clairs de la
 * rampe porteraient du texte blanc illisible.
 */
export function monoInk(seed: string): string {
  const step = MONO_STEPS[hashOf(seed) % MONO_STEPS.length]!;
  return step > 58 ? 'oklch(14% 0 0)' : 'oklch(98% 0 0)';
}

/** Emojis proposes en acces rapide sur la barre de reactions. */
export const QUICK_REACTIONS = ['👍', '🎉', '❤️', '😂', '👀', '🔥'] as const;

/** Derive une couleur stable a partir d'un identifiant. */
export function accentFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return ACCENTS[Math.abs(hash) % ACCENTS.length]!;
}

/** Initiales affichees dans un avatar sans image. */
export function initialsFor(name: string): string {
  const parts = name.trim().split(/[\s_.-]+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}
