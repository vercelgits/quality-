import { create } from 'zustand';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { playCue } from '@/lib/sounds';
import {
  useDevices,
  audioConstraints,
  videoConstraints,
  screenConstraints,
  screenBitrate,
  cameraBitrate,
  applyEncodingWithRetry,
  preferVideoCodec,
} from '@/store/devices';
import type { UUID, VoiceParticipant, VoiceSignal } from '@/types/db';

/**
 * Role d'un flux video.
 *
 * Camera et partage d'ecran arrivent tous deux comme des pistes `video` :
 * rien dans WebRTC ne les distingue. Chaque emetteur annonce donc le role de
 * son flux par son identifiant, et le recepteur fait la correspondance.
 */
type StreamPurpose = 'camera' | 'screen';

interface StreamInfo {
  kind: 'stream-info';
  from: UUID;
  to: UUID;
  streamId: string;
  purpose: StreamPurpose;
}

type VoiceMessage = VoiceSignal | StreamInfo;

/**
 * Salons vocaux en WebRTC maille.
 *
 * Chaque participant ouvre une connexion directe vers chacun des autres. Le
 * serveur ne voit jamais l'audio : il ne relaie que la signalisation, via un
 * canal Broadcast de Supabase. La latence est donc celle d'un lien direct, et
 * la conversation reste chiffree de bout en bout par construction.
 *
 * Contrepartie a connaitre : en maillage, chacun envoie son flux a tous les
 * autres. Le cout monte au carre du nombre de personnes, ce qui reste
 * confortable jusqu'a six ou huit participants et devient lourd au-dela.
 * Passer cette limite demanderait un serveur de melange (SFU), qui n'a pas sa
 * place dans une architecture sans backend.
 */

/**
 * Serveurs de decouverte reseau.
 *
 * Un serveur STUN ne transporte ni son ni image : il sert uniquement a
 * decouvrir son adresse publique pour percer les box et les pare-feux. La voix
 * et l'ecran, eux, vont directement d'une machine a l'autre.
 *
 * Ils restent une dependance : celui qu'on interroge voit l'adresse IP de qui
 * rejoint un salon. D'ou la configuration par l'environnement — renseigner
 * `VITE_ICE_SERVERS` avec son propre serveur (coturn, par exemple) rend
 * l'ensemble reellement autonome. Les serveurs publics de Google ne servent
 * que de repli, pour que l'application marche sans rien installer.
 *
 * Format attendu : un JSON, ou une liste d'adresses separees par des virgules.
 */
function readIceServers(): RTCIceServer[] {
  const brut = import.meta.env['VITE_ICE_SERVERS'];
  if (typeof brut !== 'string' || brut.trim() === '') {
    return [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ];
  }

  try {
    const analyse: unknown = JSON.parse(brut);
    if (Array.isArray(analyse)) return analyse as RTCIceServer[];
  } catch {
    // Pas du JSON : on accepte aussi la forme courte, une liste d'adresses.
  }

  return brut
    .split(',')
    .map((adresse) => adresse.trim())
    .filter(Boolean)
    .map((urls) => ({ urls }));
}

const ICE_SERVERS: RTCIceServer[] = readIceServers();

interface VoiceState {
  channelId: UUID | null;
  userId: UUID | null;
  connecting: boolean;
  error: string | null;

  muted: boolean;
  deafened: boolean;
  sharing: boolean;

  localStream: MediaStream | null;
  /** Flux de partage d'ecran local, distinct du micro. */
  localScreen: MediaStream | null;
  /** Flux de camera local. */
  localCamera: MediaStream | null;
  /** Camera activee. */
  cameraOn: boolean;
  /** Flux de camera distants. */
  remoteCameras: Record<UUID, MediaStream>;
  /** Partage affiche en grand, s'il y en a un. */
  focusedShare: UUID | null;

  /**
   * Partages que l'on a choisi de regarder.
   *
   * Recevoir un flux ne coute presque rien ; le decoder coute cher. Une
   * definition 1080p a soixante images par seconde occupe un coeur entier sur
   * une machine modeste — imposee a chacun, y compris a qui n'a aucune envie de
   * regarder. Rien ne se decode donc avant un clic.
   */
  watchedShares: Record<UUID, boolean>;
  /** Flux audio distants, indexes par identifiant d'utilisateur. */
  remoteAudio: Record<UUID, MediaStream>;
  /** Flux de partage d'ecran distants, indexes de la meme facon. */
  remoteScreens: Record<UUID, MediaStream>;
  /** Personnes qui parlent, detectees par analyse du niveau sonore. */
  speaking: Record<UUID, boolean>;

  participantsByChannel: Record<UUID, VoiceParticipant[]>;

  /** Mesures du partage sortant, relevees toutes les deux secondes. */
  outboundStats: {
    width: number;
    height: number;
    fps: number;
    /** Debit reellement emis, en kilobits par seconde. */
    kbps: number;
  } | null;

  join: (channelId: UUID, userId: UUID) => Promise<void>;
  leave: () => Promise<void>;
  toggleMute: () => void;
  toggleDeafen: () => void;
  toggleScreenShare: () => Promise<void>;
  toggleCamera: () => Promise<void>;
  focusShare: (userId: UUID | null) => void;
  /** Ouvre ou ferme le partage de quelqu'un. Ferme, il n'est plus decode. */
  toggleWatch: (userId: UUID) => void;
}

/* -------------------------------------------------------------------------- */
/* Ressources hors etat React                                                  */
/* -------------------------------------------------------------------------- */

/** Tout ce qu'il faut retenir d'un pair pour negocier avec lui. */
interface Peer {
  connection: RTCPeerConnection;
  /**
   * Cote « poli » de la negociation parfaite : en cas de collision entre deux
   * offres simultanees, c'est lui qui cede. Le depart est tranche par la
   * comparaison des identifiants, connue des deux cotes sans echange.
   */
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  micSender: RTCRtpSender | null;
  screenSender: RTCRtpSender | null;
  /** Son du partage, quand la source en fournit un. */
  screenAudioSender: RTCRtpSender | null;
  cameraSender: RTCRtpSender | null;
}

let room: RealtimeChannel | null = null;
const peers = new Map<UUID, Peer>();

/**
 * Role de chaque flux distant, indexe par identifiant de flux.
 *
 * L'annonce et la piste voyagent par deux canaux differents et arrivent dans
 * un ordre imprevisible : on garde donc les deux, et l'on resout des que les
 * deux moities sont la.
 */
const streamPurposes = new Map<string, StreamPurpose>();
/** Pistes recues avant leur annonce, a reclasser une fois celle-ci arrivee. */
const pendingStreams = new Map<string, { peerId: UUID; stream: MediaStream }>();
let audioContext: AudioContext | null = null;
let speechTimer: number | null = null;
const analysers = new Map<UUID, AnalyserNode>();

/**
 * Cadence maximale des annonces d'etat vocal.
 *
 * Deux cents millisecondes : imperceptible a l'usage, et bien en deca de la
 * limite de Realtime meme en enchainant les clics.
 */
const INTERVALLE_PUBLICATION = 200;

let publicationDifferee: number | null = null;
let etatEnAttente = false;
let publicationEnVol = false;
let instantArrivee = 0;

/** Etat du micro avant la sourdine, pour le retablir en sortant. */
let mutedBeforeDeafen = false;

/** Plage couverte par `getByteFrequencyData`, de l'octet 0 a l'octet 255. */
export const ANALYSER_FLOOR = -100;
export const ANALYSER_CEILING = -20;

/** Repasse une valeur d'octet en decibels, dans la plage ci-dessus. */
export function byteToDecibels(value: number): number {
  return ANALYSER_FLOOR + (value / 255) * (ANALYSER_CEILING - ANALYSER_FLOOR);
}

function send(message: VoiceMessage): void {
  if (!room) return;
  void room.send({ type: 'broadcast', event: 'voice-signal', payload: message });
}

function teardownPeers(): void {
  for (const peer of peers.values()) {
    peer.connection.onicecandidate = null;
    peer.connection.ontrack = null;
    peer.connection.onnegotiationneeded = null;
    peer.connection.onconnectionstatechange = null;
    peer.connection.close();
  }
  peers.clear();
  analysers.clear();
}

/**
 * Traduit un echec de capture en phrase utile.
 *
 * `getUserMedia` echoue pour des raisons tres differentes, et le message
 * generique — « Camera inaccessible » — les melangeait toutes : refus de
 * l'utilisateur, peripherique absent, ou simplement encore tenu par le salon
 * qu'on vient de quitter. Le dernier cas est le plus frequent en changeant de
 * salon, et c'est le seul ou il n'y a rien a corriger : il suffit d'attendre.
 */
function messageDeCapture(cause: unknown, quoi: 'micro' | 'camera'): string {
  const nom = cause instanceof DOMException ? cause.name : '';
  const article = quoi === 'micro' ? 'Le micro' : 'La camera';

  if (nom === 'NotAllowedError' || nom === 'SecurityError') {
    return quoi === 'micro'
      ? "Acces au micro refuse. Autorisez-le dans les reglages du site, puis reessayez."
      : "Acces a la camera refuse. Autorisez-le dans les reglages du site, puis reessayez.";
  }

  if (nom === 'NotFoundError' || nom === 'OverconstrainedError') {
    return quoi === 'micro'
      ? "Aucun micro detecte. Branchez-en un, ou choisissez-en un autre dans les parametres."
      : "Aucune camera detectee. Branchez-en une, ou choisissez-en une autre dans les parametres.";
  }

  if (nom === 'NotReadableError' || nom === 'AbortError') {
    return `${article} est utilise par une autre application. Fermez-la, puis reessayez.`;
  }

  return `${article} n'a pas pu demarrer. Reessayez dans un instant.`;
}

/**
 * Capture, avec une seconde tentative.
 *
 * En changeant de salon, le systeme n'a pas toujours fini de rendre le
 * peripherique que la session precedente tenait. L'echec est alors temporaire
 * et se resout tout seul : une deuxieme demande, une demi-seconde plus tard,
 * aboutit. Sans elle on affichait une erreur pour un probleme deja passe.
 */
async function capturer(contraintes: MediaStreamConstraints): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia(contraintes);
  } catch (cause) {
    const recuperable =
      cause instanceof DOMException &&
      (cause.name === 'NotReadableError' || cause.name === 'AbortError');

    if (!recuperable) throw cause;

    await new Promise((resoudre) => setTimeout(resoudre, 500));
    return navigator.mediaDevices.getUserMedia(contraintes);
  }
}

/**
 * Une tuile par personne, portant son etat le plus recent.
 *
 * La presence de Realtime associe a chaque cle une *liste* d'entrees, une par
 * connexion. Une meme personne peut donc y figurer plusieurs fois : deux
 * onglets ouverts, mais surtout une connexion precedente dont le serveur n'a
 * pas encore constate la disparition — navigateur ferme sans prevenir, mise en
 * veille, reseau coupe. L'entree survit jusqu'a l'expiration du socket.
 *
 * En laissant passer les doublons, on affichait deux tuiles pour la meme
 * personne, dont une figee dans l'etat ou sa connexion s'est perdue.
 *
 * On garde l'entree arrivee en dernier : `joined_at` est fige a l'arrivee, donc
 * la plus grande valeur designe la connexion la plus recente.
 */
function dedupliquer(entrees: VoiceParticipant[]): VoiceParticipant[] {
  const parPersonne = new Map<UUID, VoiceParticipant>();

  for (const entree of entrees) {
    const connue = parPersonne.get(entree.user_id);
    if (!connue || entree.joined_at >= connue.joined_at) parPersonne.set(entree.user_id, entree);
  }

  return [...parPersonne.values()].sort((a, b) => a.joined_at - b.joined_at);
}

export const useVoice = create<VoiceState>((set, get) => {
  /**
   * Publie l'etat vocal, au plus une fois par intervalle.
   *
   * Chaque bascule declenchait un envoi. Enchainer les clics sur le micro
   * depassait la limite de Realtime, les envois suivants etaient abandonnes, et
   * l'anneau des participants restait fige sur un etat perime — c'est le defaut
   * qu'on observe en spammant le bouton.
   *
   * Le dernier etat est toujours emis : ce qui est ecarte, ce sont les etats
   * intermediaires, que personne n'a besoin de voir passer.
   */
  function publishState(): void {
    const state = get();
    if (!room || !state.channelId || !state.userId) return;

    etatEnAttente = true;

    // Un envoi est en cours, ou une fenetre est ouverte : l'etat courant sera
    // pris a la fin de l'un ou de l'autre. Rien a faire de plus.
    if (publicationEnVol || publicationDifferee !== null) return;

    void emettre();
  }

  /**
   * Emet l'etat, puis rouvre une fenetre.
   *
   * `track()` n'est jamais appele tant que le precedent n'a pas repondu. Deux
   * publications qui se chevauchaient laissaient la seconde sans reponse : sa
   * promesse ne se resolvait plus, et l'etat cessait d'etre annonce — l'anneau
   * de la personne restait fige sur son avant-derniere valeur, au bout de trois
   * bascules environ. Le symptome etait d'autant plus deroutant qu'il ne
   * demandait pas de cliquer vite.
   */
  async function emettre(): Promise<void> {
    publicationDifferee = null;
    if (!etatEnAttente) return;

    const courant = get();
    if (!room || !courant.channelId || !courant.userId) return;

    etatEnAttente = false;
    publicationEnVol = true;

    try {
      await room.track({
        user_id: courant.userId,
        channel_id: courant.channelId,
        muted: courant.muted,
        deafened: courant.deafened,
        sharing: courant.sharing,
        video: courant.cameraOn,
        // L'instant d'arrivee, fige : le reactualiser a chaque envoi ferait
        // paraitre chaque mise a jour comme une nouvelle arrivee.
        joined_at: instantArrivee,
      } satisfies VoiceParticipant);
    } catch {
      // Un envoi perdu n'est pas grave en soi : le suivant portera l'etat
      // complet, puisque c'est l'etat courant qui est publie, non un delta.
    } finally {
      publicationEnVol = false;
    }

    // Une fenetre s'ouvre : un changement survenu pendant l'envoi part a sa
    // fermeture, sans qu'on ait a l'emettre aussitot.
    if (room) publicationDifferee = window.setTimeout(() => void emettre(), INTERVALLE_PUBLICATION);
  }

  /**
   * Analyse le niveau sonore d'un flux pour allumer l'indicateur « parle ».
   * Le seuil est volontairement haut afin qu'un bruit de clavier ne declenche
   * pas le halo.
   */
  function attachAnalyser(peerId: UUID, stream: MediaStream): void {
    try {
      audioContext ??= new AudioContext();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.6;
      // Bornes fixees explicitement : sans cela elles varient selon le
      // navigateur, et le seuil regle dans les parametres ne voudrait pas dire
      // la meme chose d'une machine a l'autre.
      analyser.minDecibels = ANALYSER_FLOOR;
      analyser.maxDecibels = ANALYSER_CEILING;
      source.connect(analyser);
      analysers.set(peerId, analyser);
    } catch {
      // L'analyse du son est un confort : son echec ne doit pas couper l'appel.
    }
  }

  function startSpeechDetection(): void {
    if (speechTimer !== null) return;

    const buffer = new Uint8Array(256);
    speechTimer = window.setInterval(() => {
      if (analysers.size === 0) return;

      const threshold = useDevices.getState().media.speakingThreshold;

      const speaking: Record<UUID, boolean> = {};
      for (const [peerId, analyser] of analysers) {
        analyser.getByteFrequencyData(buffer);

        // Le pic plutot que la moyenne : la voix n'occupe qu'une partie du
        // spectre, et la moyenne sur des bandes vides la diluerait au point que
        // le seuil ne correspondrait plus a rien d'audible.
        let peak = 0;
        for (let index = 0; index < buffer.length; index += 1) {
          if (buffer[index]! > peak) peak = buffer[index]!;
        }

        speaking[peerId] = byteToDecibels(peak) > threshold;
      }
      set({ speaking });
    }, 220);
  }

  /*
   * Releve de la qualite reellement emise.
   *
   * Les chiffres viennent de WebRTC lui-meme, pas de ce qu'on a demande : c'est
   * la seule facon de savoir si le debit demande est effectivement atteint. Un
   * partage annonce en 1080p60 qui sort a deux megabits se voit ici, alors
   * qu'a l'oeil on hesite entre « le reseau » et « le code ».
   */
  let statsTimer: number | null = null;
  let dernierOctets = 0;
  let dernierInstant = 0;

  function startStats(): void {
    if (statsTimer !== null) return;

    statsTimer = window.setInterval(() => {
      const emetteur = [...peers.values()].find((pair) => pair.screenSender)?.screenSender;
      if (!emetteur) {
        set({ outboundStats: null });
        return;
      }

      void emetteur.getStats().then((rapport) => {
        for (const entree of rapport.values()) {
          if (entree.type !== 'outbound-rtp' || entree.kind !== 'video') continue;

          const octets = entree.bytesSent ?? 0;
          const instant = entree.timestamp ?? performance.now();
          const ecart = (instant - dernierInstant) / 1000;

          // Le premier releve n'a rien a quoi se comparer : on l'utilise comme
          // point de depart plutot que d'afficher un debit fantaisiste.
          const kbps =
            dernierInstant > 0 && ecart > 0
              ? Math.round(((octets - dernierOctets) * 8) / ecart / 1000)
              : 0;

          dernierOctets = octets;
          dernierInstant = instant;

          set({
            outboundStats: {
              width: entree.frameWidth ?? 0,
              height: entree.frameHeight ?? 0,
              fps: Math.round(entree.framesPerSecond ?? 0),
              kbps,
            },
          });
          return;
        }
      });
    }, 2000);
  }

  function stopStats(): void {
    if (statsTimer !== null) {
      window.clearInterval(statsTimer);
      statsTimer = null;
    }
    dernierOctets = 0;
    dernierInstant = 0;
    set({ outboundStats: null });
  }

  function stopSpeechDetection(): void {
    if (speechTimer !== null) {
      window.clearInterval(speechTimer);
      speechTimer = null;
    }
    set({ speaking: {} });
  }

  /** Fait savoir a un pair a quoi correspond un flux qu'on lui envoie. */
  function announceStream(peerId: UUID, streamId: string, purpose: StreamPurpose): void {
    const me = get().userId;
    if (!me) return;
    send({ kind: 'stream-info', from: me, to: peerId, streamId, purpose });
  }

  function dropPeer(peerId: UUID): void {
    const peer = peers.get(peerId);
    if (peer) {
      peer.connection.close();
      peers.delete(peerId);
    }
    analysers.delete(peerId);

    set((state) => {
      const remoteAudio = { ...state.remoteAudio };
      const remoteScreens = { ...state.remoteScreens };
      const remoteCameras = { ...state.remoteCameras };
      delete remoteAudio[peerId];
      delete remoteScreens[peerId];
      delete remoteCameras[peerId];
      return {
        remoteAudio,
        remoteScreens,
        remoteCameras,
        focusedShare: state.focusedShare === peerId ? null : state.focusedShare,
      };
    });
  }

  /**
   * Range un flux video recu dans la bonne categorie.
   *
   * Si l'annonce n'est pas encore arrivee, le flux est mis en attente plutot
   * que devine : classer une camera comme partage d'ecran l'afficherait en
   * grand au milieu de la fenetre.
   */
  function placeVideoStream(peerId: UUID, stream: MediaStream): void {
    const purpose = streamPurposes.get(stream.id);

    if (!purpose) {
      pendingStreams.set(stream.id, { peerId, stream });
      return;
    }

    pendingStreams.delete(stream.id);

    if (purpose === 'screen') {
      /*
       * Un partage arrive ferme.
       *
       * Le decodage ne demarre qu'au clic sur « Regarder ». Sans cela, ouvrir
       * un salon ou trois personnes diffusent lancait trois decodages
       * simultanes, que l'on veuille les regarder ou non — de quoi rendre
       * l'application inutilisable sur une machine modeste, sans que rien
       * n'explique pourquoi.
       */
      const regarde = get().watchedShares[peerId] === true;
      for (const piste of stream.getVideoTracks()) piste.enabled = regarde;

      set((state) => ({ remoteScreens: { ...state.remoteScreens, [peerId]: stream } }));
    } else {
      set((state) => ({ remoteCameras: { ...state.remoteCameras, [peerId]: stream } }));
    }
  }

  /**
   * Cree la connexion vers un pair et cable la negociation parfaite.
   *
   * `onnegotiationneeded` remplace les offres declenchees a la main : ajouter ou
   * retirer une piste de partage d'ecran suffit alors a relancer la
   * negociation, sans code specifique a chaque cas.
   */
  function createPeer(peerId: UUID, localStream: MediaStream): Peer {
    const existing = peers.get(peerId);
    if (existing) return existing;

    const me = get().userId ?? '';
    const connection = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    const peer: Peer = {
      connection,
      polite: me > peerId,
      makingOffer: false,
      ignoreOffer: false,
      micSender: null,
      screenSender: null,
      screenAudioSender: null,
      cameraSender: null,
    };

    for (const track of localStream.getAudioTracks()) {
      peer.micSender = connection.addTrack(track, localStream);
    }

    // Si un partage ou une camera sont deja actifs, le nouvel arrivant doit
    // les recevoir, et connaitre leur role.
    const screen = get().localScreen;
    const screenTrack = screen?.getVideoTracks()[0];
    if (screen && screenTrack) {
      peer.screenSender = connection.addTrack(screenTrack, screen);
      // Un pair qui arrive en cours de partage doit recevoir la meme qualite
      // que les autres : sans cela il herite du debit par defaut.
      void applyEncodingWithRetry(
        peer.screenSender,
        screenBitrate(useDevices.getState().media),
        useDevices.getState().media.screenPriority,
      );
      announceStream(peerId, screen.id, 'screen');
    }

    const camera = get().localCamera;
    const cameraTrack = camera?.getVideoTracks()[0];
    if (camera && cameraTrack) {
      peer.cameraSender = connection.addTrack(cameraTrack, camera);
      void applyEncodingWithRetry(peer.cameraSender, cameraBitrate(useDevices.getState().media), 'detail');
      announceStream(peerId, camera.id, 'camera');
    }

    connection.onicecandidate = (event) => {
      if (!event.candidate) return;
      const self = get().userId;
      if (self) {
        send({ kind: 'ice', from: self, to: peerId, candidate: event.candidate.toJSON() });
      }
    };

    connection.ontrack = (event) => {
      const [stream] = event.streams;
      if (!stream) return;

      // Audio et video du meme pair arrivent sur des flux distincts. Les
      // ranger ensemble ferait qu'un partage d'ecran remplacerait la voix.
      if (event.track.kind === 'video') {
        placeVideoStream(peerId, stream);

        event.track.addEventListener('ended', () => {
          streamPurposes.delete(stream.id);
          pendingStreams.delete(stream.id);
          set((state) => {
            const remoteScreens = { ...state.remoteScreens };
            const remoteCameras = { ...state.remoteCameras };
            delete remoteScreens[peerId];
            delete remoteCameras[peerId];
            return {
              remoteScreens,
              remoteCameras,
              focusedShare: state.focusedShare === peerId ? null : state.focusedShare,
            };
          });
        });
      } else {
        set((state) => ({ remoteAudio: { ...state.remoteAudio, [peerId]: stream } }));
        attachAnalyser(peerId, stream);
      }
    };

    connection.onnegotiationneeded = async () => {
      try {
        peer.makingOffer = true;
        await connection.setLocalDescription();
        const self = get().userId;
        if (self && connection.localDescription?.sdp) {
          send({ kind: 'offer', from: self, to: peerId, sdp: connection.localDescription.sdp });
        }
      } catch {
        // Une negociation avortee sera relancee par le prochain changement.
      } finally {
        peer.makingOffer = false;
      }
    };

    connection.onconnectionstatechange = () => {
      const state = connection.connectionState;
      if (state === 'failed' || state === 'closed') dropPeer(peerId);
    };

    peers.set(peerId, peer);
    return peer;
  }

  /** Traite un message de signalisation qui nous est adresse. */
  async function handleSignal(signal: VoiceMessage): Promise<void> {
    const localStream = get().localStream;
    if (!localStream) return;

    // Annonce du role d'un flux : on l'enregistre, puis on reclasse la piste
    // si elle etait deja arrivee.
    if (signal.kind === 'stream-info') {
      streamPurposes.set(signal.streamId, signal.purpose);
      const waiting = pendingStreams.get(signal.streamId);
      if (waiting) placeVideoStream(waiting.peerId, waiting.stream);
      return;
    }

    const peer = createPeer(signal.from, localStream);
    const { connection } = peer;

    try {
      if (signal.kind === 'offer' || signal.kind === 'answer') {
        const description: RTCSessionDescriptionInit = {
          type: signal.kind,
          sdp: signal.sdp,
        };

        // Collision : les deux cotes ont emis une offre en meme temps. Le cote
        // impoli garde la sienne et ignore celle d'en face ; le cote poli
        // abandonne la sienne par un rollback implicite.
        const offerCollision =
          signal.kind === 'offer' &&
          (peer.makingOffer || connection.signalingState !== 'stable');

        peer.ignoreOffer = !peer.polite && offerCollision;
        if (peer.ignoreOffer) return;

        await connection.setRemoteDescription(description);

        if (signal.kind === 'offer') {
          await connection.setLocalDescription();
          const self = get().userId;
          if (self && connection.localDescription?.sdp) {
            send({
              kind: 'answer',
              from: self,
              to: signal.from,
              sdp: connection.localDescription.sdp,
            });
          }
        }
        return;
      }

      await connection.addIceCandidate(signal.candidate);
    } catch {
      // Un candidat arrive avant sa description distante est sans consequence :
      // les suivants le remplaceront.
    }
  }

  /** Ouvre les connexions manquantes et ferme celles des partis. */
  function syncPeers(participants: VoiceParticipant[]): void {
    const me = get().userId;
    const localStream = get().localStream;
    if (!me || !localStream) return;

    const others = participants.filter((participant) => participant.user_id !== me);
    const present = new Set(others.map((participant) => participant.user_id));

    for (const peerId of [...peers.keys()]) {
      if (!present.has(peerId)) {
        dropPeer(peerId);
        playCue('peer-leave');
      }
    }

    for (const participant of others) {
      const peerId = participant.user_id;
      if (peers.has(peerId)) continue;

      playCue('peer-join');

      // Un seul cote amorce, sinon les deux negocient en meme temps. La
      // comparaison des identifiants donne un arbitre stable ; l'autre attend
      // l'offre. `onnegotiationneeded` se declenche a l'ajout des pistes.
      if (me < peerId) createPeer(peerId, localStream);
    }
  }

  return {
    channelId: null,
    userId: null,
    connecting: false,
    error: null,

    muted: false,
    deafened: false,
    sharing: false,

    localStream: null,
    localScreen: null,
    localCamera: null,
    cameraOn: false,
    remoteAudio: {},
    remoteScreens: {},
    remoteCameras: {},
    focusedShare: null,
    watchedShares: {},
    speaking: {},
    participantsByChannel: {},
    outboundStats: null,

    join: async (channelId, userId) => {
      if (get().channelId === channelId) return;

      if (get().channelId) {
        await get().leave();
        // Le systeme ne rend pas le micro instantanement : le redemander
        // aussitot echoue avec « peripherique inaccessible », surtout quand un
        // logiciel de routage audio est en jeu. Une image d'attente suffit a
        // laisser la liberation aboutir.
        await new Promise((resoudre) => setTimeout(resoudre, 120));
      }

      set({ connecting: true, error: null });

      let localStream: MediaStream;
      try {
        localStream = await capturer({
          audio: audioConstraints(useDevices.getState().media),
          video: false,
        });
      } catch (cause) {
        set({ connecting: false, error: messageDeCapture(cause, 'micro') });
        return;
      }

      instantArrivee = Date.now();
      set({ channelId, userId, localStream, connecting: false });

      // Son propre micro passe par le meme analyseur que ceux des autres.
      // Sans cela, la pastille de parole ne s'allumait jamais pour soi : on
      // voyait les autres parler, jamais soi, et rien n'indiquait si le micro
      // captait quoi que ce soit.
      attachAnalyser(userId, localStream);
      startSpeechDetection();

      playCue('join');

      room = supabase.channel(`orbit:voice:${channelId}`, {
        config: { presence: { key: userId }, broadcast: { self: false } },
      });

      room
        .on('broadcast', { event: 'voice-signal' }, ({ payload }) => {
          const signal = payload as VoiceSignal;
          if (signal.to !== userId) return;
          void handleSignal(signal);
        })
        .on('presence', { event: 'sync' }, () => {
          if (!room) return;
          const participants = dedupliquer(
            Object.values(room.presenceState<VoiceParticipant>())
              .flat()
              .filter((entry): entry is VoiceParticipant & { presence_ref: string } =>
                Boolean(entry && typeof entry === 'object' && 'user_id' in entry),
              ),
          );

          set((state) => ({
            participantsByChannel: { ...state.participantsByChannel, [channelId]: participants },
          }));
          syncPeers(participants);
        })
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') publishState();
        });

      startSpeechDetection();
    },

    leave: async () => {
      if (get().channelId) playCue('leave');
      const { localStream, localScreen, localCamera, channelId } = get();

      // La publication differee doit s'arreter avec le salon : sinon elle
      // tenterait d'annoncer un etat sur un canal deja ferme.
      if (publicationDifferee !== null) {
        window.clearTimeout(publicationDifferee);
        publicationDifferee = null;
      }
      etatEnAttente = false;

      stopSpeechDetection();
      stopStats();
      teardownPeers();
      streamPurposes.clear();
      pendingStreams.clear();

      for (const track of localStream?.getTracks() ?? []) track.stop();
      for (const track of localScreen?.getTracks() ?? []) track.stop();
      for (const track of localCamera?.getTracks() ?? []) track.stop();

      /*
       * Le canal est ferme sans attendre.
       *
       * `untrack` puis `removeChannel` sont deux allers-retours reseau. Les
       * attendre avant de vider l'etat laissait l'interface figee une seconde
       * ou deux apres le clic sur « Quitter » — on croyait que rien ne s'etait
       * passe et on recliquait.
       *
       * Rien ne depend de leur reponse : les pistes sont deja coupees, et la
       * presence expire d'elle-meme a la fermeture du socket.
       */
      if (room) {
        const ferme = room;
        room = null;

        void (async () => {
          try {
            await ferme.untrack();
            await supabase.removeChannel(ferme);
          } catch {
            // Le socket se refermera seul ; la presence expirera avec lui.
          }
        })();
      }

      set((state) => {
        const participantsByChannel = { ...state.participantsByChannel };
        if (channelId) delete participantsByChannel[channelId];
        return {
          channelId: null,
          localStream: null,
          localScreen: null,
          localCamera: null,
          cameraOn: false,
          remoteAudio: {},
          remoteScreens: {},
          remoteCameras: {},
          focusedShare: null,
          speaking: {},
          sharing: false,
          muted: false,
          deafened: false,
          participantsByChannel,
        };
      });
    },

    toggleMute: () => {
      const { localStream, muted } = get();
      const next = !muted;

      for (const track of localStream?.getAudioTracks() ?? []) {
        track.enabled = !next;
      }
      // Reactiver le micro alors qu'on est sourd n'aurait pas de sens : on
      // retablit le son en meme temps.
      set({ muted: next, deafened: next ? get().deafened : false });
      playCue(next ? 'mute' : 'unmute');
      publishState();
    },

    /**
     * Sourdine.
     *
     * Se rendre sourd coupe aussi le micro, comme partout ailleurs. Le
     * retablir doit rendre le micro tel qu'il etait avant — et non le laisser
     * coupe, ce qui obligeait a un second clic sans qu'on comprenne pourquoi,
     * et se voyait surtout apres plusieurs bascules d'affilee.
     */
    toggleDeafen: () => {
      const { deafened, muted, localStream } = get();
      const next = !deafened;

      // L'etat du micro est retenu au moment ou l'on devient sourd, pas apres :
      // ensuite il vaut forcement « coupe » et l'information est perdue.
      if (next) mutedBeforeDeafen = muted;

      const nextMuted = next ? true : mutedBeforeDeafen;

      for (const track of localStream?.getAudioTracks() ?? []) {
        track.enabled = !nextMuted;
      }

      set({ deafened: next, muted: nextMuted });
      playCue(next ? 'deafen' : 'undeafen');
      publishState();
    },

    toggleScreenShare: async () => {
      const { sharing, localScreen } = get();

      if (sharing) {
        for (const peer of peers.values()) {
          if (peer.screenSender) {
            // `removeTrack` declenche `onnegotiationneeded` : la renegociation
            // part toute seule, sans offre construite a la main.
            peer.connection.removeTrack(peer.screenSender);
            peer.screenSender = null;
          }
        }
        for (const track of localScreen?.getTracks() ?? []) track.stop();

        set({ sharing: false, localScreen: null });
        stopStats();
        playCue('share-stop');
        publishState();
        return;
      }

      let display: MediaStream;
      try {
        display = await navigator.mediaDevices.getDisplayMedia({
          video: {
            ...screenConstraints(useDevices.getState().media),
            // Le selecteur s'ouvre sur l'ecran entier, ce qu'on partage le
            // plus souvent.
            displaySurface: 'monitor',
          },

          // Le son de ce qui est partage part avec l'image. Sans lui, montrer
          // une video ou un jeu revient a mimer. Les traitements du micro sont
          // desactives : ils sont faits pour une voix, et ils ecraseraient de
          // la musique.
          audio: useDevices.getState().media.shareSystemAudio
            ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
            : false,

          // Notre propre fenetre est retiree de la liste : la partager
          // afficherait le partage a l'interieur de lui-meme, en miroir sans
          // fin. C'est une erreur qu'on ne fait qu'une fois, mais qu'on fait.
          selfBrowserSurface: 'exclude',

          // On peut changer de source sans couper : sinon il faut arreter,
          // rouvrir le selecteur, et tout le monde voit l'ecran disparaitre.
          surfaceSwitching: 'include',
        } as DisplayMediaStreamOptions);
      } catch {
        // Selecteur de fenetre annule : rien a signaler.
        return;
      }

      const [videoTrack] = display.getVideoTracks();
      if (!videoTrack) return;

      // L'indice de contenu oriente l'encodeur avant meme la negociation :
      // « motion » lui dit de sacrifier la nettete plutot que la fluidite.
      // Sans lui, un 1080p a soixante images est traite comme une webcam.
      videoTrack.contentHint =
        useDevices.getState().media.screenPriority === 'motion' ? 'motion' : 'detail';

      // Le partage s'arrete aussi depuis la barre du navigateur. Sans suivre cet
      // evenement, l'interface afficherait un partage qui n'existe plus.
      videoTrack.addEventListener('ended', () => {
        for (const peer of peers.values()) {
          if (peer.screenSender) {
            peer.connection.removeTrack(peer.screenSender);
            peer.screenSender = null;
          }
          if (peer.screenAudioSender) {
            peer.connection.removeTrack(peer.screenAudioSender);
            peer.screenAudioSender = null;
          }
        }
        set({ sharing: false, localScreen: null });
        publishState();
      });

      const media = useDevices.getState().media;

      // Le son du partage, quand la source en fournit. Il voyage dans le meme
      // flux que l'image : le separer obligerait a resynchroniser a l'arrivee.
      const [audioTrack] = display.getAudioTracks();

      for (const [peerId, peer] of peers) {
        peer.screenSender = peer.connection.addTrack(videoTrack, display);

        // Le codec se choisit sur le transceiver, pas sur l'emetteur : c'est
        // lui qui porte la negociation.
        const transceiver = peer.connection
          .getTransceivers()
          .find((t) => t.sender === peer.screenSender);
        if (transceiver) preferVideoCodec(transceiver);

        void applyEncodingWithRetry(peer.screenSender, screenBitrate(media), media.screenPriority);

        if (audioTrack) {
          peer.screenAudioSender = peer.connection.addTrack(audioTrack, display);
        }

        announceStream(peerId, display.id, 'screen');
      }

      set({ sharing: true, localScreen: display });
      startStats();
      playCue('share-start');
      publishState();
    },

    /**
     * Camera.
     *
     * Le flux part sur une piste distincte de celle du partage d'ecran, et son
     * role est annonce a chaque pair : sans cela, le recepteur ne saurait pas
     * lequel des deux flux video afficher en vignette et lequel en grand.
     */
    toggleCamera: async () => {
      const { cameraOn, localCamera } = get();

      if (cameraOn) {
        for (const peer of peers.values()) {
          if (peer.cameraSender) {
            // `removeTrack` declenche `onnegotiationneeded` : la renegociation
            // part seule.
            peer.connection.removeTrack(peer.cameraSender);
            peer.cameraSender = null;
          }
        }
        for (const track of localCamera?.getTracks() ?? []) track.stop();

        set({ cameraOn: false, localCamera: null });
        publishState();
        return;
      }

      let camera: MediaStream;
      try {
        camera = await capturer({
          video: videoConstraints(useDevices.getState().media),
          audio: false,
        });
      } catch (cause) {
        set({ error: messageDeCapture(cause, 'camera') });
        return;
      }

      const [videoTrack] = camera.getVideoTracks();
      if (!videoTrack) return;

      // Un visage bouge peu : la nettete prime sur la fluidite.
      videoTrack.contentHint = 'detail';

      // La camera peut etre coupee depuis le systeme : sans suivre cet
      // evenement, l'interface afficherait une video qui n'existe plus.
      videoTrack.addEventListener('ended', () => {
        for (const peer of peers.values()) {
          if (peer.cameraSender) {
            peer.connection.removeTrack(peer.cameraSender);
            peer.cameraSender = null;
          }
        }
        set({ cameraOn: false, localCamera: null });
        publishState();
      });

      for (const [peerId, peer] of peers) {
        peer.cameraSender = peer.connection.addTrack(videoTrack, camera);
        void applyEncodingWithRetry(peer.cameraSender, cameraBitrate(useDevices.getState().media), 'detail');
        announceStream(peerId, camera.id, 'camera');
      }

      set({ cameraOn: true, localCamera: camera });
      publishState();
    },

    focusShare: (userId) => set({ focusedShare: userId }),

    /*
     * Regarder, ou ne pas regarder.
     *
     * Couper `enabled` sur la piste recue suffit a arreter le decodage : le
     * navigateur jette les images sans les developper. Le flux continue
     * d'arriver — c'est la bande passante, pas le processeur, et c'est le
     * processeur qui faisait ramer les machines modestes. Le rouvrir est
     * instantane, sans renegociation.
     */
    toggleWatch: (userId) => {
      const suivant = !get().watchedShares[userId];

      const flux = get().remoteScreens[userId];
      for (const piste of flux?.getVideoTracks() ?? []) piste.enabled = suivant;

      set((state) => ({
        watchedShares: { ...state.watchedShares, [userId]: suivant },
        // Fermer un partage qu'on avait agrandi le reduit aussi : le laisser
        // « agrandi » alors qu'il ne s'affiche plus n'aurait pas de sens.
        focusedShare: suivant ? state.focusedShare : null,
      }));
    },
  };
});
