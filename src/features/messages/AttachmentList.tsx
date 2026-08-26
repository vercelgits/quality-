import { useEffect, useState } from 'react';
import { signedUrl } from '@/lib/upload';
import { formatBytes } from '@/lib/time';
import { Icon } from '@/components/Icon';
import type { Attachment } from '@/types/db';

/**
 * Pieces jointes d'un message.
 *
 * Le compartiment de stockage est prive : chaque fichier demande une URL
 * signee, valable une heure. Un lien copie hors du salon cesse donc de
 * fonctionner, au lieu de rester ouvert indefiniment comme une URL publique.
 */
export function AttachmentList({ attachments }: { attachments: Attachment[] }) {
  if (attachments.length === 0) return null;

  return (
    <ul className="message__attachments">
      {attachments.map((attachment) => (
        <li key={attachment.id}>
          {attachment.content_type.startsWith('image/') ? (
            <ImageAttachment attachment={attachment} />
          ) : (
            <FileAttachment attachment={attachment} />
          )}
        </li>
      ))}
    </ul>
  );
}

/** Resout l'URL signee d'une piece jointe, une seule fois par montage. */
function useSignedUrl(storagePath: string): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void signedUrl(storagePath).then((resolved) => {
      if (!cancelled) setUrl(resolved);
    });

    return () => {
      cancelled = true;
    };
  }, [storagePath]);

  return url;
}

function ImageAttachment({ attachment }: { attachment: Attachment }) {
  const url = useSignedUrl(attachment.storage_path);

  // Les dimensions connues reservent la place avant le chargement : sans elles,
  // l'arrivee de l'image ferait sauter tout le fil de discussion.
  const ratio =
    attachment.width && attachment.height
      ? `${attachment.width} / ${attachment.height}`
      : undefined;

  return (
    <figure className="attachment-image">
      {url ? (
        <a href={url} target="_blank" rel="noopener noreferrer">
          <img
            src={url}
            alt={attachment.filename}
            loading="lazy"
            style={{ aspectRatio: ratio }}
            width={attachment.width ?? undefined}
            height={attachment.height ?? undefined}
          />
        </a>
      ) : (
        <span className="attachment-image__placeholder" style={{ aspectRatio: ratio }} />
      )}
      <figcaption className="attachment-image__caption">
        {attachment.filename} · {formatBytes(attachment.size)}
      </figcaption>
    </figure>
  );
}

function FileAttachment({ attachment }: { attachment: Attachment }) {
  const url = useSignedUrl(attachment.storage_path);

  return (
    <a
      className="attachment"
      href={url ?? undefined}
      target="_blank"
      rel="noopener noreferrer"
      aria-disabled={url === null}
    >
      <Icon name="paperclip" size={15} />
      <span className="truncate">{attachment.filename}</span>
      <span className="attachment__size">{formatBytes(attachment.size)}</span>
    </a>
  );
}
