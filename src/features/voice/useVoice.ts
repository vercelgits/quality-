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
 * confortable jusqu'a six ou huit participants et devient lourd au-dela. Passer
 * cette limite demanderait un serveur de melange (SFU), qui n'a pas sa place
 * dans une architecture sans backend.
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
  /** Flux distants, indexes par identifiant d'utilisateur. */
  remoteStreams: Record<UUID, MediaStream>;
  /** Personnes qui parlent en ce moment, detectees par analyse du niveau sonore. */
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

let room: RealtimeChannel | null = null;
const peers = new Map<UUID, RTCPeerConnection>();
const senders = new Map<UUID, RTCRtpSender[]>();
let audioContext: AudioContext | null = null;
let speechTimer: number | null = null;
const analysers = new Map<UUID, AnalyserNode>();

function publishState(get: () => VoiceState): void {
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

function send(signal: VoiceSignal): void {
  if (!room) return;
  void room.send({ type: 'broadcast', event: 'voice-signal', payload: signal });
}

/** Detache et referme toutes les connexions pair a pair. */
function teardownPeers(): void {
  for (const connection of peers.values()) {
    connection.onicecandidate = null;
    connection.ontrack = null;
    connection.onconnectionstatechange = null;
    connection.close();
  }
  peers.clear();
  senders.clear();
  analysers.clear();
}

export const useVoice = create<VoiceState>((set, get) => {
  /** Cree la connexion vers un pair et cable ses evenements. */
  function createPeer(peerId: UUID, localStream: MediaStream): RTCPeerConnection {
    const existing = peers.get(peerId);
    if (existing) return existing;

    const connection = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    const attached: RTCRtpSender[] = [];
    for (const track of localStream.getTracks()) {
      attached.push(connection.addTrack(track, localStream));
    }
    senders.set(peerId, attached);

    connection.onicecandidate = (event) => {
      if (!event.candidate) return;
      const me = get().userId;
      if (!me) return;
      send({ kind: 'ice', from: me, to: peerId, candidate: event.candidate.toJSON() });
    };

    connection.ontrack = (event) => {
      const [stream] = event.streams;
      if (!stream) return;

      set((state) => ({ remoteStreams: { ...state.remoteStreams, [peerId]: stream } }));
      attachAnalyser(peerId, stream);
    };

    connection.onconnectionstatechange = () => {
      if (connection.connectionState === 'failed' || connection.connectionState === 'closed') {
        connection.close();
        peers.delete(peerId);
        set((state) => {
          const remoteStreams = { ...state.remoteStreams };
          delete remoteStreams[peerId];
          return { remoteStreams };
        });
      }
    };

    peers.set(peerId, connection);
    return connection;
  }

  /**
   * Analyse le niveau sonore d'un flux pour allumer l'indicateur "parle".
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
        for (let i = 0; i < buffer.length; i += 1) sum += buffer[i]!;
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

  /** Traite un message de signalisation adresse a nous. */
  async function handleSignal(signal: VoiceSignal): Promise<void> {
    const localStream = get().localStream;
    if (!localStream) return;

    const connection = createPeer(signal.from, localStream);

    if (signal.kind === 'offer') {
      await connection.setRemoteDescription({ type: 'offer', sdp: signal.sdp });
      const answer = await connection.createAnswer();
      await connection.setLocalDescription(answer);

      const me = get().userId;
      if (me && answer.sdp) {
        send({ kind: 'answer', from: me, to: signal.from, sdp: answer.sdp });
      }
      return;
    }

    if (signal.kind === 'answer') {
      // Une reponse qui arrive alors qu'on n'attend plus rien signale une
      // negociation croisee : l'ignorer evite de casser la connexion en cours.
      if (connection.signalingState !== 'have-local-offer') return;
      await connection.setRemoteDescription({ type: 'answer', sdp: signal.sdp });
      return;
    }

    try {
      await connection.addIceCandidate(signal.candidate);
    } catch {
      // Un candidat peut arriver avant la description distante ; il sera
      // remplace par les suivants.
    }
  }

  /** Ouvre une offre vers les pairs dont on est l'initiateur designe. */
  async function syncPeers(participants: VoiceParticipant[]): Promise<void> {
    const me = get().userId;
    const localStream = get().localStream;
    if (!me || !localStream) return;

    const others = participants.filter((participant) => participant.user_id !== me);
    const presentIds = new Set(others.map((participant) => participant.user_id));

    // Ferme les connexions vers ceux qui sont partis.
    for (const [peerId, connection] of peers) {
      if (presentIds.has(peerId)) continue;
      connection.close();
      peers.delete(peerId);
      analysers.delete(peerId);
      set((state) => {
        const remoteStreams = { ...state.remoteStreams };
        delete remoteStreams[peerId];
        return { remoteStreams };
      });
    }

    for (const participant of others) {
      const peerId = participant.user_id;
      if (peers.has(peerId)) continue;

      // Un seul des deux cotes emet l'offre, sinon les deux negocient en meme
      // temps et la connexion echoue. La comparaison des identifiants donne un
      // arbitre stable, connu des deux cotes sans echange supplementaire.
      if (me < peerId) {
        const connection = createPeer(peerId, localStream);
        const offer = await connection.createOffer();
        await connection.setLocalDescription(offer);
        if (offer.sdp) send({ kind: 'offer', from: me, to: peerId, sdp: offer.sdp });
      }
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
    remoteStreams: {},
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
          error:
            "Micro inaccessible. Verifiez l'autorisation du navigateur, puis reessayez.",
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
          void syncPeers(participants);
        })
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') publishState(get);
        });

      startSpeechDetection();
    },

    leave: async () => {
      const { localStream, channelId } = get();

      stopSpeechDetection();
      teardownPeers();

      for (const track of localStream?.getTracks() ?? []) track.stop();

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
          remoteStreams: {},
          speaking: {},
          sharing: false,
          muted: false,
          deafened: false,
          participantsByChannel,
        };
      });
    },

    toggleMute: () => {
      const { localStream, muted, deafened } = get();
      const next = !muted;

      for (const track of localStream?.getAudioTracks() ?? []) {
        track.enabled = !next;
      }
      // Reactiver le micro alors qu'on est sourd n'a pas de sens : on retablit
      // le son en meme temps.
      set({ muted: next, deafened: next ? deafened : false });
      publishState(get);
    },

    toggleDeafen: () => {
      const { deafened, localStream } = get();
      const next = !deafened;

      // Se rendre sourd coupe aussi le micro, comme partout ailleurs.
      for (const track of localStream?.getAudioTracks() ?? []) {
        track.enabled = !next;
      }
      set({ deafened: next, muted: next ? true : get().muted });
      publishState(get);
    },

    toggleScreenShare: async () => {
      const { sharing, localStream } = get();

      if (sharing) {
        for (const [peerId, list] of senders) {
          const connection = peers.get(peerId);
          if (!connection) continue;
          for (const sender of list) {
            if (sender.track?.kind === 'video') {
              connection.removeTrack(sender);
            }
          }
        }
        set({ sharing: false });
        publishState(get);
        return;
      }

      try {
        const display = await navigator.mediaDevices.getDisplayMedia({
          video: { frameRate: 30 },
          audio: false,
        });
        const [videoTrack] = display.getVideoTracks();
        if (!videoTrack || !localStream) return;

        // Le partage s'arrete aussi depuis la barre du navigateur : il faut
        // suivre cet evenement pour ne pas afficher un partage fantome.
        videoTrack.addEventListener('ended', () => {
          set({ sharing: false });
          publishState(get);
        });

        for (const [peerId, connection] of peers) {
          const sender = connection.addTrack(videoTrack, display);
          senders.set(peerId, [...(senders.get(peerId) ?? []), sender]);

          const offer = await connection.createOffer();
          await connection.setLocalDescription(offer);
          const me = get().userId;
          if (me && offer.sdp) send({ kind: 'offer', from: me, to: peerId, sdp: offer.sdp });
        }

        set({ sharing: true });
        publishState(get);
      } catch {
        // L'utilisateur a annule le selecteur de fenetre : rien a signaler.
      }
    },
  };
});
