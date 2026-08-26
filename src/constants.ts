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
