import { useEffect, useRef, useState } from 'react';

/**
 * Image qui ne s'anime qu'au survol.
 *
 * Un GIF joue en boucle des qu'il est affiche, sans qu'on puisse l'arreter :
 * ni `pause`, ni attribut. La seule facon de le figer est d'en peindre la
 * premiere image dans un canevas et de montrer celui-ci a la place — c'est ce
 * que font les clients de messagerie qui proposent « animer au survol ».
 *
 * Le canevas remplace l'image tant qu'on ne survole pas. Au survol, l'image
 * revient et repart de sa premiere trame.
 *
 * Si quoi que ce soit echoue — image d'un autre domaine sans en-tetes CORS,
 * canevas indisponible — on laisse simplement l'image animee. Mieux vaut une
 * animation non desiree qu'un avatar absent.
 */

/** Formats susceptibles d'etre animes. Les autres n'ont rien a figer. */
const ANIMATABLE = /\.(gif|webp|apng|avif)(\?|#|$)/i;

export function isAnimatable(url: string | null | undefined): boolean {
  return typeof url === 'string' && ANIMATABLE.test(url);
}

export function AnimatedImage({
  src,
  alt,
  className,
  /** `always` joue en continu, `never` fige, `hover` ne joue qu'au survol. */
  mode,
}: {
  src: string;
  alt: string;
  className?: string;
  mode: 'always' | 'hover' | 'never';
}) {
  const [frozen, setFrozen] = useState<string | null>(null);
  const [hovered, setHovered] = useState(false);
  const cancelled = useRef(false);

  const freezable = mode !== 'always' && isAnimatable(src);

  useEffect(() => {
    cancelled.current = false;
    setFrozen(null);

    if (!freezable) return;

    const image = new Image();
    // Sans cela, peindre l'image « salit » le canevas et l'extraction leve.
    image.crossOrigin = 'anonymous';

    image.onload = () => {
      if (cancelled.current) return;
      try {
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;

        const context = canvas.getContext('2d');
        if (!context) return;

        context.drawImage(image, 0, 0);
        setFrozen(canvas.toDataURL('image/png'));
      } catch {
        // Canevas rendu inutilisable par l'origine de l'image : on garde
        // l'animation plutot que de perdre l'avatar.
      }
    };

    image.src = src;

    return () => {
      cancelled.current = true;
      image.onload = null;
    };
  }, [src, freezable]);

  // Tant que la premiere image n'est pas extraite, on montre l'originale :
  // un trou le temps du decodage serait pire que l'animation.
  const playing = mode === 'always' || (mode === 'hover' && hovered) || frozen === null;

  return (
    <img
      className={className}
      src={playing ? src : frozen}
      alt={alt}
      loading="lazy"
      draggable={false}
      onMouseEnter={mode === 'hover' ? () => setHovered(true) : undefined}
      onMouseLeave={mode === 'hover' ? () => setHovered(false) : undefined}
      // Le clavier aussi : sans cela, l'animation ne serait accessible qu'a la
      // souris.
      onFocus={mode === 'hover' ? () => setHovered(true) : undefined}
      onBlur={mode === 'hover' ? () => setHovered(false) : undefined}
    />
  );
}
