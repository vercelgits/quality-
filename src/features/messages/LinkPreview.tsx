import { useMemo, useState } from 'react';
import { Icon } from '@/components/Icon';

/**
 * Apercus de liens.
 *
 * Lire les metadonnees d'une page (titre, description, image) demande une
 * requete vers le site, que le navigateur refuse pour cause de politique
 * d'origine. Un apercu complet exigerait donc une fonction serveur qui aille
 * chercher la page et renvoie ses balises.
 *
 * Plutot que d'inventer un titre ou d'afficher une carte vide, on ne montre
 * que ce qu'on peut reellement etablir depuis le navigateur :
 *
 *  - une image dont l'adresse en est une : affichee telle quelle ;
 *  - une video YouTube ou Vimeo : lecteur integre, charge au clic ;
 *  - tout le reste : une carte sobre portant le domaine et le chemin.
 *
 * Aucune de ces trois formes ne pretend savoir quelque chose qu'elle ignore.
 */

interface Parsed {
  url: string;
  host: string;
  path: string;
}

type Preview =
  | { kind: 'image'; link: Parsed }
  | { kind: 'video'; link: Parsed; embed: string; provider: string }
  | { kind: 'link'; link: Parsed };

const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|webp|avif|svg)(\?.*)?$/i;

/** Identifiant d'une video YouTube, quelle que soit la forme de l'adresse. */
function youtubeId(url: URL): string | null {
  if (url.hostname === 'youtu.be') return url.pathname.slice(1) || null;
  if (!url.hostname.endsWith('youtube.com')) return null;
  if (url.pathname === '/watch') return url.searchParams.get('v');
  if (url.pathname.startsWith('/embed/')) return url.pathname.slice(7);
  if (url.pathname.startsWith('/shorts/')) return url.pathname.slice(8);
  return null;
}

function vimeoId(url: URL): string | null {
  if (!url.hostname.endsWith('vimeo.com')) return null;
  const match = /^\/(\d+)/.exec(url.pathname);
  return match ? match[1]! : null;
}

/** Extrait les liens d'un message et decide de la forme de chaque apercu. */
export function previewsFor(content: string, limit = 3): Preview[] {
  const found = content.match(/https?:\/\/[^\s<>()]+[^\s<>().,;:!?]/g) ?? [];
  const seen = new Set<string>();
  const previews: Preview[] = [];

  for (const raw of found) {
    if (previews.length >= limit) break;
    if (seen.has(raw)) continue;
    seen.add(raw);

    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      continue;
    }

    // `javascript:` et consorts sont exclus par la capture, mais on le
    // reverifie : un apercu rend le lien cliquable et visible.
    if (url.protocol !== 'http:' && url.protocol !== 'https:') continue;

    const link: Parsed = {
      url: raw,
      host: url.hostname.replace(/^www\./, ''),
      path: url.pathname === '/' ? '' : url.pathname,
    };

    const youtube = youtubeId(url);
    if (youtube) {
      previews.push({
        kind: 'video',
        link,
        provider: 'YouTube',
        embed: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(youtube)}`,
      });
      continue;
    }

    const vimeo = vimeoId(url);
    if (vimeo) {
      previews.push({
        kind: 'video',
        link,
        provider: 'Vimeo',
        embed: `https://player.vimeo.com/video/${encodeURIComponent(vimeo)}`,
      });
      continue;
    }

    if (IMAGE_EXTENSIONS.test(url.pathname)) {
      previews.push({ kind: 'image', link });
      continue;
    }

    previews.push({ kind: 'link', link });
  }

  return previews;
}

export function LinkPreviews({ content }: { content: string }) {
  const previews = useMemo(() => previewsFor(content), [content]);
  if (previews.length === 0) return null;

  return (
    <ul className="previews">
      {previews.map((preview) => (
        <li key={preview.link.url}>
          {preview.kind === 'image' ? (
            <ImagePreview link={preview.link} />
          ) : preview.kind === 'video' ? (
            <VideoPreview link={preview.link} embed={preview.embed} provider={preview.provider} />
          ) : (
            <LinkCard link={preview.link} />
          )}
        </li>
      ))}
    </ul>
  );
}

/* -------------------------------------------------------------------------- */

function ImagePreview({ link }: { link: Parsed }) {
  const [failed, setFailed] = useState(false);

  // Une adresse qui finit en `.png` ne garantit pas une image : si le
  // chargement echoue, on retombe sur la carte plutot que sur un cadre vide.
  if (failed) return <LinkCard link={link} />;

  return (
    <a className="preview-image" href={link.url} target="_blank" rel="noopener noreferrer nofollow">
      <img src={link.url} alt="" loading="lazy" onError={() => setFailed(true)} />
    </a>
  );
}

function VideoPreview({
  link,
  embed,
  provider,
}: {
  link: Parsed;
  embed: string;
  provider: string;
}) {
  const [playing, setPlaying] = useState(false);

  // Le lecteur n'est insere qu'au clic : une iframe par lien chargerait des
  // centaines de kilo-octets et poserait un traceur avant meme qu'on regarde.
  if (!playing) {
    return (
      <button type="button" className="preview-video" onClick={() => setPlaying(true)}>
        <span className="preview-video__play" aria-hidden="true">
          <Icon name="video" size={22} />
        </span>
        <span className="preview-video__meta">
          <span className="preview-video__provider">{provider}</span>
          <span className="preview-video__url truncate">{link.host + link.path}</span>
        </span>
        <span className="preview-video__hint">Lire ici</span>
      </button>
    );
  }

  return (
    <div className="preview-embed">
      <iframe
        src={embed}
        title={`Lecteur ${provider}`}
        allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        loading="lazy"
        referrerPolicy="strict-origin-when-cross-origin"
      />
    </div>
  );
}

function LinkCard({ link }: { link: Parsed }) {
  return (
    <a className="preview-card" href={link.url} target="_blank" rel="noopener noreferrer nofollow">
      <span className="preview-card__mark" aria-hidden="true">
        {link.host.charAt(0).toUpperCase()}
      </span>
      <span className="preview-card__body">
        <span className="preview-card__host">{link.host}</span>
        {link.path ? <span className="preview-card__path truncate">{link.path}</span> : null}
      </span>
      <Icon name="link" size={14} />
    </a>
  );
}
