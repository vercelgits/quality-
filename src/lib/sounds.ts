/**
 * Signaux sonores de l'application.
 *
 * Tout est synthetise a l'execution, rien n'est charge : pas de fichier a
 * telecharger, pas d'echantillon emprunte ailleurs, et une identite sonore qui
 * nous appartient reellement. L'ensemble tient en quelques centaines d'octets
 * de code, la ou une poignee de fichiers en pesait des dizaines de milliers.
 *
 * Le vocabulaire est tenu d'un bout a l'autre :
 *
 *  - deux notes qui montent  = quelque chose s'ouvre, quelqu'un arrive ;
 *  - deux notes qui descendent = quelque chose se ferme, quelqu'un part ;
 *  - une note breve et mate  = un basculement sans consequence.
 *
 * Les frequences suivent une gamme pentatonique : n'importe quelle paire y
 * sonne juste, meme jouee au hasard, ce qui evite les accords aigres quand
 * deux evenements se suivent de pres.
 */

/** Do, re, mi, sol, la — puis l'octave. En hertz. */
const GAMME = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5];

export type Cue =
  | 'mute'
  | 'unmute'
  | 'deafen'
  | 'undeafen'
  | 'join'
  | 'leave'
  | 'peer-join'
  | 'peer-leave'
  | 'share-start'
  | 'share-stop';

interface Note {
  /** Indice dans la gamme. */
  degre: number;
  /** Debut, en secondes depuis le declenchement. */
  debut: number;
  duree: number;
  /** Volume relatif, de 0 a 1. */
  gain: number;
}

/**
 * Partitions.
 *
 * Les evenements qui concernent quelqu'un d'autre sont plus discrets que les
 * siens : entendre le meme signal pour « je me coupe le micro » et « untel
 * arrive » rendrait les deux illisibles dans un salon anime.
 */
const PARTITIONS: Record<Cue, Note[]> = {
  mute: [{ degre: 2, debut: 0, duree: 0.09, gain: 0.5 }],
  unmute: [{ degre: 4, debut: 0, duree: 0.09, gain: 0.5 }],

  deafen: [
    { degre: 3, debut: 0, duree: 0.08, gain: 0.45 },
    { degre: 0, debut: 0.07, duree: 0.13, gain: 0.45 },
  ],
  undeafen: [
    { degre: 0, debut: 0, duree: 0.08, gain: 0.45 },
    { degre: 3, debut: 0.07, duree: 0.13, gain: 0.45 },
  ],

  join: [
    { degre: 0, debut: 0, duree: 0.1, gain: 0.5 },
    { degre: 2, debut: 0.08, duree: 0.1, gain: 0.5 },
    { degre: 4, debut: 0.16, duree: 0.2, gain: 0.5 },
  ],
  leave: [
    { degre: 4, debut: 0, duree: 0.1, gain: 0.45 },
    { degre: 2, debut: 0.08, duree: 0.1, gain: 0.45 },
    { degre: 0, debut: 0.16, duree: 0.2, gain: 0.45 },
  ],

  'peer-join': [
    { degre: 1, debut: 0, duree: 0.08, gain: 0.3 },
    { degre: 4, debut: 0.07, duree: 0.14, gain: 0.3 },
  ],
  'peer-leave': [
    { degre: 4, debut: 0, duree: 0.08, gain: 0.26 },
    { degre: 1, debut: 0.07, duree: 0.14, gain: 0.26 },
  ],

  'share-start': [
    { degre: 2, debut: 0, duree: 0.07, gain: 0.35 },
    { degre: 5, debut: 0.06, duree: 0.16, gain: 0.35 },
  ],
  'share-stop': [
    { degre: 5, debut: 0, duree: 0.07, gain: 0.3 },
    { degre: 2, debut: 0.06, duree: 0.16, gain: 0.3 },
  ],
};

/**
 * Contexte audio partage, cree au premier son.
 *
 * En creer un par signal epuiserait le quota du navigateur — six par page sur
 * Chrome — et l'application deviendrait muette au bout de quelques clics.
 */
let contexte: AudioContext | null = null;

function obtenirContexte(): AudioContext | null {
  if (typeof window === 'undefined') return null;

  try {
    contexte ??= new AudioContext();
    // Un contexte cree avant toute interaction demarre suspendu : sans cela,
    // le premier son serait perdu.
    if (contexte.state === 'suspended') void contexte.resume();
    return contexte;
  } catch {
    return null;
  }
}

/** Volume general des signaux, de 0 a 1. Regle depuis les parametres. */
let volume = 0.6;

export function setCueVolume(valeur: number): void {
  volume = Math.min(1, Math.max(0, valeur));
}

/**
 * Joue un signal.
 *
 * Une onde triangulaire plutot qu'une sinusoide : elle porte quelques
 * harmoniques, donc s'entend sur de petits haut-parleurs sans qu'il faille
 * monter le volume. Une onde carree ou en dents de scie serait, elle,
 * agressive a la longue.
 *
 * Chaque note recoit une enveloppe : une attaque tres courte pour eviter le
 * claquement d'un signal qui demarre a plein volume, et une extinction
 * exponentielle, qui est la facon dont un son s'eteint dans la nature.
 */
export function playCue(cue: Cue): void {
  if (volume <= 0) return;

  const ctx = obtenirContexte();
  if (!ctx) return;

  const partition = PARTITIONS[cue];
  const depart = ctx.currentTime;

  for (const note of partition) {
    const oscillateur = ctx.createOscillator();
    const enveloppe = ctx.createGain();

    oscillateur.type = 'triangle';
    oscillateur.frequency.value = GAMME[note.degre] ?? GAMME[0]!;

    const t0 = depart + note.debut;
    const t1 = t0 + note.duree;
    const crete = note.gain * volume;

    enveloppe.gain.setValueAtTime(0.0001, t0);
    enveloppe.gain.exponentialRampToValueAtTime(crete, t0 + 0.012);
    enveloppe.gain.exponentialRampToValueAtTime(0.0001, t1);

    oscillateur.connect(enveloppe).connect(ctx.destination);
    oscillateur.start(t0);
    oscillateur.stop(t1 + 0.02);
  }
}
