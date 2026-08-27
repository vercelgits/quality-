/**
 * Jeu d'emojis.
 *
 * Une liste choisie plutot que la totalite d'Unicode : les quelque 3 800
 * emojis existants pesent plusieurs centaines de kilo-octets avec leurs
 * mots-cles, alors que ceux-ci couvrent l'immense majorite des usages d'une
 * messagerie d'equipe.
 *
 * Les mots-cles sont en francais : chercher « pouce » doit trouver 👍, ce que
 * ne permettrait pas une base anglophone.
 */

export interface EmojiCategory {
  id: string;
  label: string;
  emojis: { char: string; keywords: string }[];
}

export const EMOJI_CATEGORIES: EmojiCategory[] = [
  {
    id: 'reactions',
    label: 'Reactions',
    emojis: [
      { char: '👍', keywords: 'pouce oui bien accord valide ok' },
      { char: '👎', keywords: 'pouce bas non desaccord refus' },
      { char: '👏', keywords: 'applaudir bravo felicitations mains' },
      { char: '🙌', keywords: 'mains levees youpi celebration' },
      { char: '🙏', keywords: 'merci priere s il te plait' },
      { char: '🤝', keywords: 'poignee main accord marche conclu' },
      { char: '✌️', keywords: 'paix victoire deux' },
      { char: '🤞', keywords: 'doigts croises chance espoir' },
      { char: '👌', keywords: 'parfait ok impeccable' },
      { char: '💪', keywords: 'force muscle courage' },
      { char: '🫡', keywords: 'salut militaire bien recu' },
      { char: '🤙', keywords: 'appelle moi cool' },
      { char: '✋', keywords: 'main stop arret' },
      { char: '👋', keywords: 'coucou bonjour au revoir salut' },
      { char: '🫶', keywords: 'coeur mains amour merci' },
      { char: '🤟', keywords: 'je t aime signe' },
    ],
  },
  {
    id: 'smileys',
    label: 'Visages',
    emojis: [
      { char: '😀', keywords: 'sourire content joie' },
      { char: '😃', keywords: 'sourire heureux' },
      { char: '😄', keywords: 'rire joie content' },
      { char: '😁', keywords: 'sourire dents ravi' },
      { char: '😆', keywords: 'rire fort mdr' },
      { char: '😅', keywords: 'rire gene sueur ouf' },
      { char: '🤣', keywords: 'mort de rire mdr ptdr roule' },
      { char: '😂', keywords: 'pleure de rire mdr larmes' },
      { char: '🙂', keywords: 'sourire leger poli' },
      { char: '😉', keywords: 'clin oeil complice' },
      { char: '😊', keywords: 'sourire timide content' },
      { char: '😍', keywords: 'amoureux coeurs yeux adore' },
      { char: '🥰', keywords: 'amour tendresse coeurs' },
      { char: '😘', keywords: 'bisou baiser' },
      { char: '😎', keywords: 'lunettes cool classe' },
      { char: '🤓', keywords: 'intello lunettes nerd' },
      { char: '🧐', keywords: 'monocle examine doute' },
      { char: '🤔', keywords: 'reflechit doute hmm pense' },
      { char: '🤨', keywords: 'sourcil sceptique doute' },
      { char: '😐', keywords: 'neutre sans expression' },
      { char: '😑', keywords: 'blase las' },
      { char: '🙄', keywords: 'yeux ciel agace exaspere' },
      { char: '😬', keywords: 'grimace gene malaise' },
      { char: '😳', keywords: 'rougit surprise gene' },
      { char: '🥺', keywords: 'suppliant yeux doux pitie' },
      { char: '😢', keywords: 'triste pleure larme' },
      { char: '😭', keywords: 'pleure fort chagrin' },
      { char: '😤', keywords: 'agace vapeur enerve' },
      { char: '😠', keywords: 'fache colere' },
      { char: '😡', keywords: 'colere rouge furieux' },
      { char: '🤯', keywords: 'explose tete choc incroyable' },
      { char: '😱', keywords: 'peur cri choc' },
      { char: '😴', keywords: 'dort sommeil fatigue' },
      { char: '🥱', keywords: 'baille ennui fatigue' },
      { char: '🤒', keywords: 'malade fievre thermometre' },
      { char: '🤕', keywords: 'blesse bandage' },
      { char: '🥳', keywords: 'fete celebration anniversaire' },
      { char: '🤩', keywords: 'etoiles yeux emerveille' },
      { char: '😇', keywords: 'ange aureole sage' },
      { char: '🤗', keywords: 'calin embrasse accueil' },
      { char: '🤫', keywords: 'chut silence secret' },
      { char: '🤐', keywords: 'bouche cousue secret' },
      { char: '😶‍🌫️', keywords: 'brouillard perdu confus' },
      { char: '🫠', keywords: 'fond malaise chaleur' },
      { char: '🫥', keywords: 'invisible efface absent' },
      { char: '😵‍💫', keywords: 'etourdi perdu confus' },
    ],
  },
  {
    id: 'work',
    label: 'Travail',
    emojis: [
      { char: '💻', keywords: 'ordinateur portable code dev' },
      { char: '🖥️', keywords: 'ordinateur ecran bureau' },
      { char: '⌨️', keywords: 'clavier saisie' },
      { char: '🖱️', keywords: 'souris curseur' },
      { char: '📱', keywords: 'telephone mobile smartphone' },
      { char: '🐛', keywords: 'bug insecte probleme erreur' },
      { char: '🔧', keywords: 'cle outil reparation' },
      { char: '🔨', keywords: 'marteau construire' },
      { char: '⚙️', keywords: 'engrenage reglage parametre' },
      { char: '🚀', keywords: 'fusee lancement deploiement rapide' },
      { char: '📦', keywords: 'paquet colis livraison version' },
      { char: '🧪', keywords: 'test eprouvette experience' },
      { char: '📊', keywords: 'graphique statistiques donnees' },
      { char: '📈', keywords: 'hausse croissance progres' },
      { char: '📉', keywords: 'baisse chute recul' },
      { char: '📝', keywords: 'note ecrire redaction' },
      { char: '📌', keywords: 'punaise epingle important' },
      { char: '📎', keywords: 'trombone piece jointe' },
      { char: '🗓️', keywords: 'calendrier date reunion' },
      { char: '⏰', keywords: 'reveil heure alarme' },
      { char: '⏳', keywords: 'sablier attente temps' },
      { char: '🔍', keywords: 'loupe recherche trouver' },
      { char: '🔒', keywords: 'cadenas ferme securite prive' },
      { char: '🔓', keywords: 'cadenas ouvert deverrouille' },
      { char: '🔑', keywords: 'cle acces mot de passe' },
      { char: '📬', keywords: 'boite lettres message courrier' },
      { char: '🗑️', keywords: 'poubelle supprimer jeter' },
      { char: '♻️', keywords: 'recyclage reprise refactor' },
      { char: '🧹', keywords: 'balai nettoyage menage' },
      { char: '🏗️', keywords: 'chantier construction travaux' },
    ],
  },
  {
    id: 'symbols',
    label: 'Symboles',
    emojis: [
      { char: '✅', keywords: 'valide fait coche termine ok' },
      { char: '☑️', keywords: 'case cochee fait' },
      { char: '❌', keywords: 'croix non erreur refus' },
      { char: '⚠️', keywords: 'attention avertissement danger' },
      { char: '🚨', keywords: 'alerte urgence gyrophare' },
      { char: '❗', keywords: 'exclamation important' },
      { char: '❓', keywords: 'question interrogation' },
      { char: '💡', keywords: 'idee ampoule suggestion' },
      { char: '🔥', keywords: 'feu chaud excellent top' },
      { char: '⭐', keywords: 'etoile favori important' },
      { char: '✨', keywords: 'etincelles nouveau brillant' },
      { char: '💯', keywords: 'cent parfait total accord' },
      { char: '🎉', keywords: 'fete celebration bravo cotillon' },
      { char: '🎊', keywords: 'confettis fete' },
      { char: '🏆', keywords: 'trophee victoire gagne' },
      { char: '🥇', keywords: 'or premier medaille' },
      { char: '🎯', keywords: 'cible objectif precis' },
      { char: '⚡', keywords: 'eclair rapide energie' },
      { char: '💥', keywords: 'explosion choc impact' },
      { char: '👀', keywords: 'yeux regarde attention vu' },
      { char: '🧠', keywords: 'cerveau reflexion intelligence' },
      { char: '❤️', keywords: 'coeur amour rouge' },
      { char: '🧡', keywords: 'coeur orange' },
      { char: '💛', keywords: 'coeur jaune' },
      { char: '💚', keywords: 'coeur vert' },
      { char: '💙', keywords: 'coeur bleu' },
      { char: '💜', keywords: 'coeur violet' },
      { char: '🖤', keywords: 'coeur noir' },
      { char: '💔', keywords: 'coeur brise chagrin' },
      { char: '🔗', keywords: 'lien chaine url' },
    ],
  },
  {
    id: 'objects',
    label: 'Objets et lieux',
    emojis: [
      { char: '☕', keywords: 'cafe boisson pause' },
      { char: '🍵', keywords: 'the boisson' },
      { char: '🍺', keywords: 'biere boisson apero' },
      { char: '🥂', keywords: 'trinquer champagne celebration' },
      { char: '🍕', keywords: 'pizza repas' },
      { char: '🍰', keywords: 'gateau anniversaire dessert' },
      { char: '🥐', keywords: 'croissant petit dejeuner' },
      { char: '🍎', keywords: 'pomme fruit' },
      { char: '🌱', keywords: 'pousse debut croissance' },
      { char: '🌍', keywords: 'terre monde global' },
      { char: '🌙', keywords: 'lune nuit' },
      { char: '☀️', keywords: 'soleil jour beau temps' },
      { char: '🌧️', keywords: 'pluie mauvais temps' },
      { char: '❄️', keywords: 'neige flocon froid gel' },
      { char: '🏠', keywords: 'maison domicile teletravail' },
      { char: '🏢', keywords: 'bureau immeuble entreprise' },
      { char: '✈️', keywords: 'avion voyage vacances' },
      { char: '🚗', keywords: 'voiture trajet route' },
      { char: '🚲', keywords: 'velo trajet' },
      { char: '🎵', keywords: 'musique note son' },
      { char: '🎧', keywords: 'casque audio musique ecoute' },
      { char: '🎮', keywords: 'jeu manette console' },
      { char: '📷', keywords: 'appareil photo image' },
      { char: '🎬', keywords: 'cinema film clap video' },
      { char: '📺', keywords: 'television ecran' },
      { char: '💰', keywords: 'argent budget cout' },
      { char: '🎁', keywords: 'cadeau surprise' },
      { char: '🧩', keywords: 'puzzle piece morceau' },
      { char: '🕐', keywords: 'horloge heure' },
      { char: '🗺️', keywords: 'carte plan itineraire' },
    ],
  },
];

/** Tous les emojis, a plat. */
export const ALL_EMOJIS = EMOJI_CATEGORIES.flatMap((category) => category.emojis);

/**
 * Recherche par mot-cle.
 *
 * La comparaison passe par une normalisation sans accents : chercher « fete »
 * doit trouver ce qui est indexe « fête », et inversement.
 */
export function searchEmojis(query: string): { char: string; keywords: string }[] {
  const needle = fold(query.trim());
  if (needle.length === 0) return [];

  return ALL_EMOJIS.filter(
    (emoji) => fold(emoji.keywords).includes(needle) || emoji.char === query.trim(),
  ).slice(0, 60);
}

function fold(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/* -------------------------------------------------------------------------- */
/* Emojis recemment utilises                                                   */
/* -------------------------------------------------------------------------- */

const RECENT_KEY = 'orbit:recent-emojis';
const RECENT_MAX = 24;

export function recentEmojis(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

export function rememberEmoji(char: string): void {
  try {
    const next = [char, ...recentEmojis().filter((item) => item !== char)].slice(0, RECENT_MAX);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Navigation privee : les recents ne survivront pas, sans consequence.
  }
}
