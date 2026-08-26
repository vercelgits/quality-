/**
 * Fond d'ambiance : trois halos colores qui derivent lentement derriere
 * l'interface.
 *
 * Le decor est purement decoratif, donc masque aux lecteurs d'ecran. Il est
 * dessine en CSS et non en canvas ou en WebGL : trois degrades flous coutent
 * quelques millisecondes au compositeur, la ou une animation par script
 * tournerait en permanence pour un resultat comparable.
 *
 * L'animation s'arrete d'elle-meme quand le systeme demande a reduire les
 * mouvements — la regle est dans la feuille de style, pas ici.
 */
export function Ambient() {
  return (
    <div className="ambient" aria-hidden="true">
      <span className="ambient__orb ambient__orb--one" />
      <span className="ambient__orb ambient__orb--two" />
      <span className="ambient__orb ambient__orb--three" />
      <span className="ambient__grain" />
    </div>
  );
}
