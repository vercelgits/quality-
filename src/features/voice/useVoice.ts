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
  applyEncoding,
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
  /** Flux audio distants, indexes par identifiant d'utilisateur. */
  remoteAudio: Record<UUID, MediaStream>;
  /** Flux de partage d'ecran distants, indexes de la meme facon. */
  remoteScreens: Record<UUID, MediaStream>;
  /** Personnes qui parlent, detectees par analyse du niveau sonore. */
  speaking: Record<UUID, boolean>;

  participantsByChannel: Record<UUID, VoiceParticipant[]>;

  join: (channelId: UUID, userId: UUID) => Promise<void>;
  leave: () => Promise<void>;
  toggleMute: () => void;
  toggleDeafen: () => void;
  toggleScreenShare: () => Promise<void>;
  toggleCamera: () => Promise<void>;
  focusShare: (userId: UUID | null) => void;
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

export const useVoice = create<VoiceState>((set, get) => {
  function publishState(): void {
    const state = get();
    if (!room || !state.channelId || !state.userId) return;

    void room.track({
      user_id: state.userId,
      channel_id: state.channelId,
      muted: state.muted,
      deafened: state.deafened,
      sharing: state.sharing,
      video: state.cameraOn,
      joined_at: Date.now(),
    } satisfies VoiceParticipant);
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
      void applyEncoding(
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
      void applyEncoding(peer.cameraSender, cameraBitrate(useDevices.getState().media), 'detail');
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
    speaking: {},
    participantsByChannel: {},

    join: async (channelId, userId) => {
      if (get().channelId === channelId) return;
      if (get().channelId) await get().leave();

      set({ connecting: true, error: null });

      let localStream: MediaStream;
      try {
        localStream = await navigator.mediaDevices.getUserMedia({
          audio: audioConstraints(useDevices.getState().media),
          video: false,
        });
      } catch {
        set({
          connecting: false,
          error: "Micro inaccessible. Verifiez l'autorisation du navigateur, puis reessayez.",
        });
        return;
      }

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
          const participants = Object.values(room.presenceState<VoiceParticipant>())
            .flat()
            .filter((entry): entry is VoiceParticipant & { presence_ref: string } =>
              Boolean(entry && typeof entry === 'object' && 'user_id' in entry),
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

      stopSpeechDetection();
      teardownPeers();
      streamPurposes.clear();
      pendingStreams.clear();

      for (const track of localStream?.getTracks() ?? []) track.stop();
      for (const track of localScreen?.getTracks() ?? []) track.stop();
      for (const track of localCamera?.getTracks() ?? []) track.stop();

      if (room) {
        await room.untrack();
        await supabase.removeChannel(room);
        room = null;
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
        void applyEncoding(peer.screenSender, screenBitrate(media), media.screenPriority);

        if (audioTrack) {
          peer.screenAudioSender = peer.connection.addTrack(audioTrack, display);
        }

        announceStream(peerId, display.id, 'screen');
      }

      set({ sharing: true, localScreen: display });
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
        camera = await navigator.mediaDevices.getUserMedia({
          video: videoConstraints(useDevices.getState().media),
          audio: false,
        });
      } catch {
        set({ error: 'Camera inaccessible. Verifiez l’autorisation du navigateur.' });
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
        void applyEncoding(peer.cameraSender, cameraBitrate(useDevices.getState().media), 'detail');
        announceStream(peerId, camera.id, 'camera');
      }

      set({ cameraOn: true, localCamera: camera });
      publishState();
    },

    focusShare: (userId) => set({ focusedShare: userId }),
  };
});
