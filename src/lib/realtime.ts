import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { useChat, viewKeyFor } from '@/store/chat';
import type {
  Channel,
  MessageRow,
  Profile,
  ReactionRow,
  Thread,
  UUID,
  VoiceParticipant,
  VoiceSignal,
} from '@/types/db';

/**
 * Pont entre Supabase Realtime et l'etat de l'application.
 *
 * Trois mecanismes distincts, choisis selon la duree de vie de la donnee :
 *
 *  - `postgres_changes` pour ce qui est persiste (messages, reactions, fils).
 *    Les politiques RLS s'appliquent aussi a ce flux : on ne recoit que les
 *    lignes qu'on aurait le droit de lire par requete.
 *  - `broadcast` pour ce qui est ephemere (frappe en cours, signalisation
 *    WebRTC). Rien n'est ecrit en base, donc rien a nettoyer ensuite.
 *  - `presence` pour savoir qui est la, avec disparition automatique a la
 *    deconnexion, meme brutale.
 */

let dataChannel: RealtimeChannel | null = null;
const rooms = new Map<UUID, RealtimeChannel>();

/* -------------------------------------------------------------------------- */
/* Flux des donnees persistees                                                 */
/* -------------------------------------------------------------------------- */

export function startRealtime(userId: UUID): () => void {
  stopRealtime();

  const chat = useChat.getState();

  dataChannel = supabase
    .channel('orbit:data')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages' },
      (payload) => {
        void useChat.getState().applyIncomingMessage(payload.new as MessageRow, userId);
      },
    )
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'messages' },
      (payload) => {
        useChat.getState().applyMessageUpdate(payload.new as MessageRow);
      },
    )
    .on(
      'postgres_changes',
      { event: 'DELETE', schema: 'public', table: 'messages' },
      (payload) => {
        // `replica identity full` garantit que l'ancienne ligne complete arrive
        // ici ; sans cela on n'aurait que la cle primaire et on ne saurait pas
        // quelle vue mettre a jour.
        useChat.getState().applyMessageDelete(payload.old as MessageRow);
      },
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'reactions' },
      (payload) => {
        const row = (payload.new ?? payload.old) as ReactionRow | undefined;
        if (row?.message_id) void refreshReactions(row.message_id);
      },
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'threads' },
      (payload) => {
        if (payload.eventType === 'DELETE') return;
        useChat.getState().applyThread(payload.new as Thread);
      },
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'channels' },
      (payload) => {
        if (payload.eventType === 'DELETE') {
          // `replica identity full` fournit l'ancienne ligne entiere : sans
          // elle, un salon supprime par quelqu'un d'autre resterait affiche.
          const gone = payload.old as Partial<Channel>;
          if (gone.id) useChat.getState().applyChannelDelete(gone.id);
          return;
        }
        useChat.getState().applyChannel(payload.new as Channel);
      },
    )
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'profiles' },
      (payload) => {
        useChat.getState().applyProfile(payload.new as Profile);
      },
    )
    .subscribe();

  // Les indicateurs de frappe expirent d'eux-memes si l'emetteur se deconnecte
  // sans envoyer d'evenement d'arret.
  const pruneTimer = window.setInterval(() => chat.pruneTyping(), 2000);

  return () => {
    window.clearInterval(pruneTimer);
    stopRealtime();
  };
}

export function stopRealtime(): void {
  if (dataChannel) {
    void supabase.removeChannel(dataChannel);
    dataChannel = null;
  }
  for (const room of rooms.values()) {
    void supabase.removeChannel(room);
  }
  rooms.clear();
}

/** Recharge les reactions d'un message apres un changement. */
async function refreshReactions(messageId: UUID): Promise<void> {
  const { data } = await supabase
    .from('reactions')
    .select('message_id, user_id, emoji, created_at')
    .eq('message_id', messageId);

  useChat.getState().applyReactionChange(messageId, (data ?? []) as ReactionRow[]);
}

/* -------------------------------------------------------------------------- */
/* Salles ephemeres : frappe, presence, vocal                                  */
/* -------------------------------------------------------------------------- */

export interface RoomHandlers {
  onTyping?: (payload: { user_id: UUID; thread_id: UUID | null }) => void;
  onVoiceState?: (participants: VoiceParticipant[]) => void;
  onVoiceSignal?: (signal: VoiceSignal) => void;
}

/**
 * Rejoint la salle d'un salon. Une seule salle par salon est ouverte, quel que
 * soit le nombre de composants qui s'y abonnent.
 */
export function joinRoom(channelId: UUID, userId: UUID, handlers: RoomHandlers): RealtimeChannel {
  const existing = rooms.get(channelId);
  if (existing) return existing;

  const room = supabase.channel(`orbit:room:${channelId}`, {
    config: {
      presence: { key: userId },
      broadcast: { self: false },
    },
  });

  room
    .on('broadcast', { event: 'typing' }, ({ payload }) => {
      const data = payload as { user_id: UUID; thread_id: UUID | null };
      if (data.user_id === userId) return;
      useChat.getState().setTyping(viewKeyFor(channelId, data.thread_id), data.user_id);
      handlers.onTyping?.(data);
    })
    .on('broadcast', { event: 'voice-signal' }, ({ payload }) => {
      const signal = payload as VoiceSignal;
      // Chaque pair recoit tout le trafic de la salle : on ignore ce qui ne
      // nous est pas adresse.
      if (signal.to !== userId) return;
      handlers.onVoiceSignal?.(signal);
    })
    .on('presence', { event: 'sync' }, () => {
      const state = room.presenceState<VoiceParticipant>();
      const participants = Object.values(state)
        .flat()
        .filter((entry): entry is VoiceParticipant & { presence_ref: string } =>
          Boolean(entry && 'channel_id' in entry),
        );
      handlers.onVoiceState?.(participants);
    });

  void room.subscribe();
  rooms.set(channelId, room);
  return room;
}

export function leaveRoom(channelId: UUID): void {
  const room = rooms.get(channelId);
  if (!room) return;
  void supabase.removeChannel(room);
  rooms.delete(channelId);
}

export function roomFor(channelId: UUID): RealtimeChannel | null {
  return rooms.get(channelId) ?? null;
}

/* -------------------------------------------------------------------------- */
/* Frappe en cours                                                             */
/* -------------------------------------------------------------------------- */

const lastTypingSentAt = new Map<UUID, number>();

/**
 * Signale que l'utilisateur est en train d'ecrire.
 *
 * L'envoi est limite a un message toutes les trois secondes : sans cela chaque
 * touche enfoncee produirait un evenement reseau, pour une information qui ne
 * change pas.
 */
export function sendTyping(channelId: UUID, threadId: UUID | null, userId: UUID): void {
  const now = Date.now();
  const key = viewKeyFor(channelId, threadId);

  if (now - (lastTypingSentAt.get(key) ?? 0) < 3000) return;
  lastTypingSentAt.set(key, now);

  const room = rooms.get(channelId);
  if (!room) return;

  void room.send({
    type: 'broadcast',
    event: 'typing',
    payload: { user_id: userId, thread_id: threadId },
  });
}
