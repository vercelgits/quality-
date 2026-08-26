import { supabase } from '@/lib/supabase';
import { LIMITS } from '@/constants';
import type { UUID } from '@/types/db';

/**
 * Televersement des pieces jointes vers le stockage Supabase.
 *
 * Le chemin suit la convention `{channel_id}/{uuid}-{nom}`. Ce n'est pas
 * cosmetique : les politiques de stockage lisent le premier segment du chemin
 * pour decider qui a le droit de lire le fichier. Changer cette forme
 * reviendrait a ouvrir le compartiment a tout le monde.
 */

export interface PendingUpload {
  /** Identifiant local, pour suivre l'element avant qu'il n'existe en base. */
  id: string;
  file: File;
  /** URL locale d'apercu pour les images, liberee apres usage. */
  previewUrl: string | null;
  progress: 'waiting' | 'uploading' | 'done' | 'error';
  storagePath: string | null;
  error: string | null;
  width: number | null;
  height: number | null;
}

const BUCKET = 'attachments';

/** Nettoie un nom de fichier pour qu'il traverse le stockage sans surprise. */
function safeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .slice(-80);
}

/** Mesure une image avant envoi, pour reserver sa place a l'affichage. */
function measure(file: File): Promise<{ width: number; height: number } | null> {
  if (!file.type.startsWith('image/')) return Promise.resolve(null);

  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
      URL.revokeObjectURL(url);
    };
    image.onerror = () => {
      resolve(null);
      URL.revokeObjectURL(url);
    };
    image.src = url;
  });
}

export function toPending(file: File): PendingUpload {
  return {
    id: crypto.randomUUID(),
    file,
    previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
    progress: 'waiting',
    storagePath: null,
    error: null,
    width: null,
    height: null,
  };
}

/** Rejette un fichier trop lourd avant d'avoir consomme le reseau. */
export function rejectionReason(file: File): string | null {
  if (file.size > LIMITS.attachmentBytes) {
    return `« ${file.name} » depasse 25 Mo.`;
  }
  if (file.size === 0) {
    return `« ${file.name} » est vide.`;
  }
  return null;
}

export async function uploadOne(
  pending: PendingUpload,
  channelId: UUID,
): Promise<PendingUpload> {
  const path = `${channelId}/${pending.id}-${safeName(pending.file.name)}`;

  const dimensions = await measure(pending.file);

  const { error } = await supabase.storage.from(BUCKET).upload(path, pending.file, {
    contentType: pending.file.type || 'application/octet-stream',
    upsert: false,
  });

  if (error) {
    return { ...pending, progress: 'error', error: error.message };
  }

  return {
    ...pending,
    progress: 'done',
    storagePath: path,
    width: dimensions?.width ?? null,
    height: dimensions?.height ?? null,
  };
}

/**
 * Lien de telechargement signe, valable une heure.
 *
 * Le compartiment est prive : sans signature, aucune URL ne fonctionne, ce qui
 * empeche qu'un lien partage hors du salon reste indefiniment ouvert.
 */
export async function signedUrl(storagePath: string): Promise<string | null> {
  const { data } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, 3600);
  return data?.signedUrl ?? null;
}

/** Libere les apercus locaux, qui autrement resteraient en memoire. */
export function releasePreviews(uploads: PendingUpload[]): void {
  for (const upload of uploads) {
    if (upload.previewUrl) URL.revokeObjectURL(upload.previewUrl);
  }
}
