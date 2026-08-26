/** Formatage des dates, en francais, avec le fuseau du navigateur. */

const timeFormat = new Intl.DateTimeFormat('fr-FR', {
  hour: '2-digit',
  minute: '2-digit',
});

const dayFormat = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});

const dayWithYearFormat = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

const fullFormat = new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'full',
  timeStyle: 'short',
});

const relativeFormat = new Intl.RelativeTimeFormat('fr-FR', { numeric: 'auto' });

export function formatTime(iso: string): string {
  return timeFormat.format(new Date(iso));
}

export function formatFull(iso: string): string {
  return fullFormat.format(new Date(iso));
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** "Aujourd'hui", "Hier", sinon la date ecrite en toutes lettres. */
export function formatDayLabel(iso: string): string {
  const date = new Date(iso);
  const now = new Date();

  const dayDelta = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);

  if (dayDelta === 0) return "Aujourd'hui";
  if (dayDelta === 1) return 'Hier';

  const label = date.getFullYear() === now.getFullYear()
    ? dayFormat.format(date)
    : dayWithYearFormat.format(date);

  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** "il y a 3 minutes", "hier", etc. */
export function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const seconds = Math.round((then - Date.now()) / 1000);
  const absolute = Math.abs(seconds);

  if (absolute < 45) return "a l'instant";
  if (absolute < 3600) return relativeFormat.format(Math.round(seconds / 60), 'minute');
  if (absolute < 86_400) return relativeFormat.format(Math.round(seconds / 3600), 'hour');
  if (absolute < 2_592_000) return relativeFormat.format(Math.round(seconds / 86_400), 'day');
  if (absolute < 31_536_000) return relativeFormat.format(Math.round(seconds / 2_592_000), 'month');
  return relativeFormat.format(Math.round(seconds / 31_536_000), 'year');
}

/** Vrai si les deux instants tombent le meme jour civil. */
export function isSameDay(a: string, b: string): boolean {
  return startOfDay(new Date(a)) === startOfDay(new Date(b));
}

/**
 * Vrai si deux messages consecutifs du meme auteur peuvent etre regroupes,
 * c'est-a-dire affiches sans repeter l'avatar ni le nom.
 */
export function canGroup(previousIso: string, currentIso: string): boolean {
  const delta = new Date(currentIso).getTime() - new Date(previousIso).getTime();
  return delta >= 0 && delta < 5 * 60 * 1000 && isSameDay(previousIso, currentIso);
}

/** Duree en minutes:secondes, pour la duree passee en vocal. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;

  const pad = (value: number) => value.toString().padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

/** Taille de fichier lisible. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  const units = ['ko', 'Mo', 'Go'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}
