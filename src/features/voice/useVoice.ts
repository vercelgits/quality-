import { create } from 'zustand';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import type { UUID, VoiceParticipant, VoiceSignal } from '@/types/db';

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

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

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
}

let room: RealtimeChannel | null = null;
const peers = new Map<UUID, Peer>();
let audioContext: AudioContext | null = null;
let speechTimer: number | null = null;
const analysers = new Map<UUID, AnalyserNode>();

function send(signal: VoiceSignal): void {
  if (!room) return;
  void room.send({ type: 'broadcast', event: 'voice-signal', payload: signal });
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
      video: false,
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

      const speaking: Record<UUID, boolean> = {};
      for (const [peerId, analyser] of analysers) {
        analyser.getByteFrequencyData(buffer);
        let sum = 0;
        for (let index = 0; index < buffer.length; index += 1) sum += buffer[index]!;
        speaking[peerId] = sum / buffer.length > 18;
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
      delete remoteAudio[peerId];
      delete remoteScreens[peerId];
      return { remoteAudio, remoteScreens };
    });
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
    };

    for (const track of localStream.getAudioTracks()) {
      peer.micSender = connection.addTrack(track, localStream);
    }

    // Si un partage est deja en cours, le nouvel arrivant doit le recevoir.
    const screen = get().localScreen;
    const screenTrack = screen?.getVideoTracks()[0];
    if (screen && screenTrack) {
      peer.screenSender = connection.addTrack(screenTrack, screen);
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

      // Audio et video du meme pair arrivent sur deux flux distincts. Les
      // ranger ensemble ferait qu'un partage d'ecran remplacerait la voix.
      if (event.track.kind === 'video') {
        set((state) => ({ remoteScreens: { ...state.remoteScreens, [peerId]: stream } }));

        event.track.addEventListener('ended', () => {
          set((state) => {
            const remoteScreens = { ...state.remoteScreens };
            delete remoteScreens[peerId];
            return { remoteScreens };
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
  async function handleSignal(signal: VoiceSignal): Promise<void> {
    const localStream = get().localStream;
    if (!localStream) return;

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
      if (!present.has(peerId)) dropPeer(peerId);
    }

    for (const participant of others) {
      const peerId = participant.user_id;
      if (peers.has(peerId)) continue;

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
    remoteAudio: {},
    remoteScreens: {},
    speaking: {},
    participantsByChannel: {},

    join: async (channelId, userId) => {
      if (get().channelId === channelId) return;
      if (get().channelId) await get().leave();

      set({ connecting: true, error: null });

      let localStream: MediaStream;
      try {
        localStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
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
      const { localStream, localScreen, channelId } = get();

      stopSpeechDetection();
      teardownPeers();

      for (const track of localStream?.getTracks() ?? []) track.stop();
      for (const track of localScreen?.getTracks() ?? []) track.stop();

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
          remoteAudio: {},
          remoteScreens: {},
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
      publishState();
    },

    toggleDeafen: () => {
      const { deafened, localStream } = get();
      const next = !deafened;

      // Se rendre sourd coupe aussi le micro, comme partout ailleurs.
      for (const track of localStream?.getAudioTracks() ?? []) {
        track.enabled = !next;
      }
      set({ deafened: next, muted: next ? true : get().muted });
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
        publishState();
        return;
      }

      let display: MediaStream;
      try {
        display = await navigator.mediaDevices.getDisplayMedia({
          video: { frameRate: 30 },
          audio: false,
        });
      } catch {
        // Selecteur de fenetre annule : rien a signaler.
        return;
      }

      const [videoTrack] = display.getVideoTracks();
      if (!videoTrack) return;

      // Le partage s'arrete aussi depuis la barre du navigateur. Sans suivre cet
      // evenement, l'interface afficherait un partage qui n'existe plus.
      videoTrack.addEventListener('ended', () => {
        for (const peer of peers.values()) {
          if (peer.screenSender) {
            peer.connection.removeTrack(peer.screenSender);
            peer.screenSender = null;
          }
        }
        set({ sharing: false, localScreen: null });
        publishState();
      });

      for (const peer of peers.values()) {
        peer.screenSender = peer.connection.addTrack(videoTrack, display);
      }

      set({ sharing: true, localScreen: display });
      publishState();
    },
  };
});
