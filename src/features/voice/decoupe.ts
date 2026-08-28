/**
 * Partage d'une fenetre seule, decoupee dans l'image de l'ecran.
 *
 * Le moteur web impose sa fenetre de selection a chaque `getDisplayMedia`.
 * Pour l'eviter, l'application de bureau demande a Chromium de choisir seul
 * l'ecran entier — voir `desactiver_selecteur_webview` cote Rust. La capture
 * porte donc toujours sur tout l'ecran.
 *
 * Partager une fenetre consiste alors a n'en emettre qu'une decoupe. Sans cela,
 * choisir une fenetre dans notre selecteur diffuserait tout l'ecran sans le
 * dire — un piege, pas une fonctionnalite.
 *
 * Ce que la decoupe ne sait pas faire, et il faut le savoir : ce qui recouvre
 * la fenetre est diffuse avec elle. Le systeme ne nous donne que l'image finale
 * de l'ecran ; distinguer les fenetres au-dessus demanderait de les capturer
 * separement, ce que seule une capture native permettrait.
 */

/** Position de la source a l'ecran, telle que le systeme la donne. */
interface Zone {
  x: number;
  y: number;
  largeur: number;
  hauteur: number;
  visible: boolean;
}

/** Intervalle de suivi. Assez court pour qu'un deplacement ne traine pas,
 *  assez long pour ne pas interroger le systeme soixante fois par seconde. */
const SUIVI = 250;

export interface Decoupe {
  /** Nulle si l'ecran n'a rendu aucune piste : le partage n'a alors pas lieu. */
  piste: MediaStreamTrack | undefined;
  arreter: () => void;
  /** Vrai quand la fenetre choisie n'etait pas sur l'ecran principal : c'est
   *  alors l'ecran entier qui part, et il faut le dire. */
  horsEcranPrincipal?: boolean;
}

/**
 * Produit une piste video limitee a la zone de la source choisie.
 *
 * `sourceId` est l'identifiant rendu par `sources_partageables`. Un ecran n'a
 * rien a decouper : la fonction rend alors la piste d'origine, sans passer par
 * un canevas — un aller-retour par le processeur pour recopier l'image entiere
 * couterait cher et n'apporterait rien.
 */
export async function decouperSource(
  ecran: MediaStream,
  sourceId: string,
  images: number,
): Promise<Decoupe> {
  const [pisteEcran] = ecran.getVideoTracks();

  if (!pisteEcran || sourceId.startsWith('ecran:')) {
    return { piste: pisteEcran, arreter: () => {} };
  }

  const { invoke } = await import('@tauri-apps/api/core');

  let zone = await invoke<Zone>('zone_source', { id: sourceId });
  if (!zone.visible || zone.largeur <= 0) {
    // La fenetre a disparu entre le choix et le demarrage : mieux vaut
    // diffuser l'ecran que rien du tout, et l'interface le dira.
    return { piste: pisteEcran, arreter: () => {} };
  }

  /*
   * L'ecran est lu dans une balise video hors document.
   *
   * `MediaStreamTrackProcessor` serait plus direct, mais il n'existe pas
   * partout et le repli devrait de toute facon etre ecrit. Une balise video
   * suffit : le decodage reste dans le moteur, on ne fait que recopier.
   */
  const video = document.createElement('video');
  video.srcObject = new MediaStream([pisteEcran]);
  video.muted = true;
  video.playsInline = true;
  await video.play().catch(() => undefined);

  const canevas = document.createElement('canvas');
  canevas.width = zone.largeur;
  canevas.height = zone.hauteur;

  const pinceau = canevas.getContext('2d', { alpha: false });
  if (!pinceau) return { piste: pisteEcran, arreter: () => {} };

  /*
   * Repere : celui de l'ecran principal.
   *
   * La selection automatique porte sur « l'ecran entier », c'est-a-dire le
   * moniteur principal, dont le coin haut-gauche est l'origine du bureau sous
   * Windows. Les coordonnees d'une fenetre posee dessus se lisent donc telles
   * quelles.
   *
   * Une fenetre sur un second ecran a des coordonnees hors de cette image :
   * la decouper donnerait un rectangle noir. On prefere alors diffuser l'ecran
   * entier — ce que l'interface annonce — plutot qu'une image vide.
   */
  if (
    zone.x < 0 ||
    zone.y < 0 ||
    zone.x + zone.largeur > window.screen.width ||
    zone.y + zone.hauteur > window.screen.height
  ) {
    return { piste: pisteEcran, arreter: () => {}, horsEcranPrincipal: true };
  }

  let vivant = true;

  const suivre = window.setInterval(() => {
    void invoke<Zone>('zone_source', { id: sourceId })
      .then((suivante) => {
        if (!vivant || !suivante.visible || suivante.largeur <= 0) return;
        zone = suivante;

        // Redimensionner le canevas remet son contenu a zero : on ne le fait
        // que lorsque la taille change reellement.
        if (canevas.width !== zone.largeur || canevas.height !== zone.hauteur) {
          canevas.width = zone.largeur;
          canevas.height = zone.hauteur;
        }
      })
      .catch(() => undefined);
  }, SUIVI);

  const dessiner = () => {
    if (!vivant) return;

    // L'image capturee peut etre plus petite que l'ecran si le systeme
    // applique une mise a l'echelle : on ramene les coordonnees dans le repere
    // de la video plutot que de supposer qu'ils coincident.
    const facteur = video.videoWidth > 0 ? video.videoWidth / window.screen.width : 1;

    pinceau.drawImage(
      video,
      zone.x * facteur,
      zone.y * facteur,
      zone.largeur * facteur,
      zone.hauteur * facteur,
      0,
      0,
      canevas.width,
      canevas.height,
    );
  };

  // `requestVideoFrameCallback` cale le dessin sur les images reellement
  // recues : dessiner plus souvent recopierait deux fois la meme image, moins
  // souvent perdrait de la fluidite.
  const parImage = (
    video as HTMLVideoElement & {
      requestVideoFrameCallback?: (rappel: () => void) => number;
    }
  ).requestVideoFrameCallback?.bind(video);

  let boucle = 0;

  if (parImage) {
    const suite = () => {
      dessiner();
      if (vivant) parImage(suite);
    };
    parImage(suite);
  } else {
    boucle = window.setInterval(dessiner, 1000 / images);
  }

  const flux = canevas.captureStream(images);
  const [piste] = flux.getVideoTracks();

  // Un canevas rend toujours une piste ; le typage ne le sait pas.
  if (!piste) return { piste: pisteEcran, arreter: () => {} };

  return {
    piste,
    arreter: () => {
      vivant = false;
      window.clearInterval(suivre);
      if (boucle) window.clearInterval(boucle);
      piste.stop();
      video.srcObject = null;
    },
  };
}
