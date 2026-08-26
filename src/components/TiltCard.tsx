import { useCallback, useRef, type CSSProperties, type ReactNode } from 'react';

/**
 * Carte qui s'incline legerement sous le curseur.
 *
 * L'inclinaison est calculee a partir de la position du pointeur dans la
 * carte, puis ecrite dans des variables CSS. Le rendu se fait donc entierement
 * en CSS, sur des proprietes que le navigateur compose sur le GPU : le fil
 * principal de React n'est jamais sollicite pendant le mouvement, ce qui
 * evite de saccader une liste de messages qui defile a cote.
 *
 * L'amplitude vient de `--tilt-max`, que la feuille de jetons met a zero quand
 * le systeme demande a reduire les animations. L'effet disparait alors sans
 * qu'aucune condition ne soit ecrite ici.
 */

interface TiltCardProps {
  children: ReactNode;
  className?: string;
  /** Ajoute un reflet qui suit le curseur. */
  glare?: boolean;
  style?: CSSProperties;
  as?: 'div' | 'article' | 'section' | 'li';
}

export function TiltCard({
  children,
  className = '',
  glare = true,
  style,
  as: Tag = 'div',
}: TiltCardProps) {
  const ref = useRef<HTMLElement>(null);
  const frame = useRef<number | null>(null);

  const handleMove = useCallback((event: React.PointerEvent<HTMLElement>) => {
    const node = ref.current;
    if (!node) return;

    // Un seul calcul par image affichee : sans cela, une souris rapide
    // declencherait plusieurs dizaines de mises a jour entre deux rendus.
    if (frame.current !== null) return;

    const { clientX, clientY } = event;

    frame.current = requestAnimationFrame(() => {
      frame.current = null;

      const rect = node.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;

      // Coordonnees ramenees dans [-0.5, 0.5], le centre valant zero.
      const x = (clientX - rect.left) / rect.width - 0.5;
      const y = (clientY - rect.top) / rect.height - 0.5;

      // L'axe X s'incline selon la position verticale, et inversement : c'est
      // ce croisement qui donne l'impression de pousser un objet reel.
      node.style.setProperty('--tilt-x', `${(-y * 2).toFixed(3)}`);
      node.style.setProperty('--tilt-y', `${(x * 2).toFixed(3)}`);
      node.style.setProperty('--glare-x', `${((x + 0.5) * 100).toFixed(1)}%`);
      node.style.setProperty('--glare-y', `${((y + 0.5) * 100).toFixed(1)}%`);
    });
  }, []);

  const handleLeave = useCallback(() => {
    const node = ref.current;
    if (!node) return;

    if (frame.current !== null) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
    }

    node.style.setProperty('--tilt-x', '0');
    node.style.setProperty('--tilt-y', '0');
  }, []);

  return (
    <Tag
      // Le typage des refs differe selon la balise ; la conversion est ici sans
      // risque puisque toutes les balises autorisees sont des HTMLElement.
      ref={ref as React.Ref<never>}
      className={`tilt ${className}`}
      style={style}
      onPointerMove={handleMove}
      onPointerLeave={handleLeave}
    >
      <span className="tilt__inner">
        {glare ? <span className="tilt__glare" aria-hidden="true" /> : null}
        {children}
      </span>
    </Tag>
  );
}
