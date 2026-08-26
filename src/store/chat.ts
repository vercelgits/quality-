import { create } from 'zustand';
import { supabase, errorMessage } from '@/lib/supabase';
import { LIMITS } from '@/constants';
import { notify, preview } from '@/lib/notify';
import type {
  Attachment,
  Bookmark,
  BootstrapPayload,
  Category,
  Channel,
  Message,
  MessageRow,
  Poll,
  Profile,
  ReactionGroup,
  ReactionRow,
  ReadState,
  Space,
  SpaceMember,
  SpaceTimeout,
  Thread,
  UUID,
} from '@/types/db';

/**
 * Cle d'une vue de messages : l'identifiant du salon pour la vue principale,
 * celui du fil pour un panneau lateral. Les deux vivent dans la meme table, ce
 * qui evite de dupliquer toute la logique de chargement et de temps reel.
 */
export type ViewKey = UUID;

export function viewKeyFor(channelId: UUID, threadId: UUID | null): ViewKey {
  return threadId ?? channelId;
}

/* -------------------------------------------------------------------------- */
/* Assemblage des messages                                                     */
/* -------------------------------------------------------------------------- */

type RawMessage = MessageRow & {
  reactions?: Pick<ReactionRow, 'user_id' | 'emoji' | 'created_at'>[] | null;
  attachments?: Attachment[] | null;
  polls?: Poll[] | Poll | null;
};

/** Supabase renvoie une relation un-a-un tantot seule, tantot dans un tableau. */
function firstOf<T>(value: T[] | T | null | undefined): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

/** Regroupe les reactions brutes par emoji, en conservant l'ordre d'apparition. */
function groupReactions(rows: Pick<ReactionRow, 'user_id' | 'emoji' | 'created_at'>[]): ReactionGroup[] {
  const byEmoji = new Map<string, ReactionGroup>();
  const ordered = [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at));

  for (const row of ordered) {
    const group = byEmoji.get(row.emoji) ?? { emoji: row.emoji, count: 0, reacted_by: [] };
    group.count += 1;
    group.reacted_by.push(row.user_id);
    byEmoji.set(row.emoji, group);
  }
  return [...byEmoji.values()];
}

function toMessage(raw: RawMessage, thread: Thread | null): Message {
  return {
    id: raw.id,
    channel_id: raw.channel_id,
    thread_id: raw.thread_id,
    author_id: raw.author_id,
    content: raw.content,
    created_at: raw.created_at,
    edited_at: raw.edited_at,
    reply_to_id: raw.reply_to_id,
    pinned: raw.pinned,
    reactions: groupReactions(raw.reactions ?? []),
    attachments: raw.attachments ?? [],
    thread,
    poll: firstOf(raw.polls),
  };
}

/**
 * Fusionne deux listes de messages en supprimant les doublons et en gardant
 * l'ordre chronologique.
 *
 * La deduplication est indispensable : un message envoye apparait d'abord de
 * facon optimiste, puis revient par le canal temps reel avec le meme
 * identifiant. Sans cette etape il s'afficherait deux fois.
 */
function mergeMessages(existing: Message[], incoming: Message[]): Message[] {
  const byId = new Map<UUID, Message>();
  for (const message of existing) byId.set(message.id, message);

  for (const message of incoming) {
    const previous = byId.get(message.id);
    // La version confirmee remplace la version optimiste, mais on conserve les
    // reactions deja connues si la nouvelle version n'en apporte pas.
    byId.set(message.id, previous ? { ...previous, ...message, pending: false, failed: false } : message);
  }

  return [...byId.values()].sort((a, b) => {
    const delta = a.created_at.localeCompare(b.created_at);
    return delta !== 0 ? delta : a.id.localeCompare(b.id);
  });
}

/* -------------------------------------------------------------------------- */
/* Etat                                                                        */
/* -------------------------------------------------------------------------- */

interface ChatState {
  ready: boolean;
  error: string | null;

  spaces: Space[];
  channels: Channel[];
  categories: Category[];
  members: SpaceMember[];
  profiles: Record<UUID, Profile>;
  threads: Record<UUID, Thread>;
  readStates: Record<UUID, ReadState>;

  /** Rang de l'utilisateur par espace : 0 membre, 1 moderateur, 2 admin, 3 proprietaire. */
  ranks: Record<UUID, number>;
  /** Exclusions de parole en cours qui le concernent, par espace. */
  timeouts: Record<UUID, SpaceTimeout>;
  bookmarks: Bookmark[];

  messages: Record<ViewKey, Message[]>;
  hasMore: Record<ViewKey, boolean>;
  loading: Record<ViewKey, boolean>;

  /** `channelKey -> userId -> instant de la derniere frappe`. */
  typing: Record<ViewKey, Record<UUID, number>>;

  bootstrap: () => Promise<void>;
  loadMessages: (channelId: UUID, threadId?: UUID | null) => Promise<void>;
  loadOlder: (channelId: UUID, threadId?: UUID | null) => Promise<void>;

  sendMessage: (input: {
    channelId: UUID;
    threadId?: UUID | null;
    content: string;
    replyToId?: UUID | null;
    authorId: UUID;
    attachments?: {
      storage_path: string;
      filename: string;
      content_type: string;
      size: number;
      width: number | null;
      height: number | null;
    }[];
  }) => Promise<void>;
  retryMessage: (view: ViewKey, messageId: UUID) => Promise<void>;
  editMessage: (view: ViewKey, messageId: UUID, content: string) => Promise<void>;
  deleteMessage: (view: ViewKey, messageId: UUID) => Promise<void>;
  toggleReaction: (view: ViewKey, messageId: UUID, emoji: string, userId: UUID) => Promise<void>;
  togglePin: (view: ViewKey, messageId: UUID) => Promise<void>;

  startThread: (messageId: UUID, title: string) => Promise<Thread | null>;
  setThreadResolved: (threadId: UUID, resolved: boolean) => Promise<void>;

  markRead: (channelId: UUID) => Promise<void>;
  bumpUnread: (channelId: UUID, isMention: boolean) => void;

  toggleBookmark: (messageId: UUID, note?: string | null) => Promise<void>;
  reportMessage: (messageId: UUID, reason: string) => Promise<boolean>;

  createSpace: (name: string, description?: string) => Promise<Space | null>;
  joinSpace: (inviteCode: string) => Promise<Space | null>;
  createChannel: (spaceId: UUID, name: string, kind: 'text' | 'voice') => Promise<void>;

  /* Points d'entree utilises par la couche temps reel. */
  applyIncomingMessage: (raw: MessageRow, currentUserId: UUID) => Promise<void>;
  applyMessageUpdate: (raw: MessageRow) => void;
  applyMessageDelete: (raw: MessageRow) => void;
  applyReactionChange: (messageId: UUID, rows: ReactionRow[]) => void;
  applyThread: (thread: Thread) => void;
  applyProfile: (profile: Profile) => void;
  applyChannel: (channel: Channel) => void;
  setTyping: (view: ViewKey, userId: UUID) => void;
  pruneTyping: () => void;
  reset: () => void;
}

const MESSAGE_SELECT_FULL =
  '*, reactions(user_id, emoji, created_at), attachments(*), polls(*)';

/**
 * Selection de repli, sans les sondages.
 *
 * PostgREST refuse une jointure imbriquee vers une table qu'il ne connait pas
 * et fait alors echouer toute la requete : sans ce repli, une base a laquelle
 * il manque la migration des sondages n'afficherait plus aucun message. On
 * prefere perdre les sondages que perdre la conversation.
 */
const MESSAGE_SELECT_BASE = '*, reactions(user_id, emoji, created_at), attachments(*)';

/** Passe a `false` des qu'on a constate que la table des sondages manque. */
let pollsAvailable = true;

function messageSelect(): string {
  return pollsAvailable ? MESSAGE_SELECT_FULL : MESSAGE_SELECT_BASE;
}

/** Vrai si l'erreur signale une relation absente du cache de schema. */
function isMissingRelationship(error: { message?: string } | null): boolean {
  return Boolean(error?.message?.includes('relationship') && error.message.includes('polls'));
}

export const useChat = create<ChatState>((set, get) => ({
  ready: false,
  error: null,

  spaces: [],
  channels: [],
  categories: [],
  members: [],
  profiles: {},
  threads: {},
  readStates: {},

  ranks: {},
  timeouts: {},
  bookmarks: [],

  messages: {},
  hasMore: {},
  loading: {},
  typing: {},

  /* ------------------------------------------------------------------ Amorcage */

  bootstrap: async () => {
    const { data, error } = await supabase.rpc('bootstrap');

    if (error) {
      set({ error: errorMessage(error), ready: true });
      return;
    }

    const payload = data as BootstrapPayload;

    set({
      ready: true,
      error: null,
      spaces: payload.spaces ?? [],
      channels: payload.channels ?? [],
      categories: payload.categories ?? [],
      members: payload.members ?? [],
      profiles: Object.fromEntries((payload.profiles ?? []).map((p) => [p.id, p])),
      threads: Object.fromEntries((payload.open_threads ?? []).map((t) => [t.id, t])),
      readStates: Object.fromEntries((payload.read_states ?? []).map((r) => [r.channel_id, r])),
      ranks: payload.ranks ?? {},
      timeouts: Object.fromEntries((payload.timeouts ?? []).map((t) => [t.space_id, t])),
      bookmarks: payload.bookmarks ?? [],
    });
  },

  /* ------------------------------------------------------------------ Lecture */

  loadMessages: async (channelId, threadId = null) => {
    const view = viewKeyFor(channelId, threadId);
    if (get().loading[view]) return;

    set((state) => ({ loading: { ...state.loading, [view]: true } }));

    const build = () => {
      const base = supabase
        .from('messages')
        .select(messageSelect())
        .eq('channel_id', channelId)
        .order('created_at', { ascending: false })
        .limit(LIMITS.messagePageSize);
      return threadId ? base.eq('thread_id', threadId) : base.is('thread_id', null);
    };

    let { data, error } = await build();

    if (isMissingRelationship(error)) {
      pollsAvailable = false;
      ({ data, error } = await build());
    }

    if (error) {
      set((state) => ({ loading: { ...state.loading, [view]: false }, error: errorMessage(error) }));
      return;
    }

    // La selection etant construite a l execution, PostgREST ne peut plus en
    // inferer le type : le passage par `unknown` est ici la conversion honnete.
    const raws = (data ?? []) as unknown as RawMessage[];
    const threads = await fetchThreadsFor(raws.map((row) => row.id));
    const built = raws.map((raw) => toMessage(raw, threads.get(raw.id) ?? null)).reverse();

    set((state) => ({
      messages: { ...state.messages, [view]: mergeMessages(state.messages[view] ?? [], built) },
      hasMore: { ...state.hasMore, [view]: raws.length === LIMITS.messagePageSize },
      loading: { ...state.loading, [view]: false },
      threads: { ...state.threads, ...Object.fromEntries([...threads.values()].map((t) => [t.id, t])) },
    }));
  },

  loadOlder: async (channelId, threadId = null) => {
    const view = viewKeyFor(channelId, threadId);
    const state = get();
    const current = state.messages[view] ?? [];

    if (state.loading[view] || state.hasMore[view] === false || current.length === 0) return;

    const oldest = current[0]!;
    set((s) => ({ loading: { ...s.loading, [view]: true } }));

    let query = supabase
      .from('messages')
      .select(messageSelect())
      .eq('channel_id', channelId)
      // Le curseur est l'instant du plus ancien message affiche. Les egalites
      // exactes sont improbables, et la fusion par identifiant les absorbe de
      // toute facon sans creer de doublon.
      .lt('created_at', oldest.created_at)
      .order('created_at', { ascending: false })
      .limit(LIMITS.messagePageSize);

    query = threadId ? query.eq('thread_id', threadId) : query.is('thread_id', null);

    const { data, error } = await query;

    if (error) {
      set((s) => ({ loading: { ...s.loading, [view]: false }, error: errorMessage(error) }));
      return;
    }

    // La selection etant construite a l execution, PostgREST ne peut plus en
    // inferer le type : le passage par `unknown` est ici la conversion honnete.
    const raws = (data ?? []) as unknown as RawMessage[];
    const threads = await fetchThreadsFor(raws.map((row) => row.id));
    const built = raws.map((raw) => toMessage(raw, threads.get(raw.id) ?? null));

    set((s) => ({
      messages: { ...s.messages, [view]: mergeMessages(s.messages[view] ?? [], built) },
      hasMore: { ...s.hasMore, [view]: raws.length === LIMITS.messagePageSize },
      loading: { ...s.loading, [view]: false },
      threads: { ...s.threads, ...Object.fromEntries([...threads.values()].map((t) => [t.id, t])) },
    }));
  },

  /* ------------------------------------------------------------------ Ecriture */

  sendMessage: async ({
    channelId,
    threadId = null,
    content,
    replyToId = null,
    authorId,
    attachments = [],
  }) => {
    const trimmed = content.trim();
    // Un envoi sans texte reste valide s'il porte un fichier.
    if (!trimmed && attachments.length === 0) return;

    const view = viewKeyFor(channelId, threadId);

    // L'identifiant est genere ici et envoye tel quel a Postgres. Le message
    // optimiste et sa confirmation partagent donc la meme cle, ce qui rend la
    // deduplication exacte quand l'echo temps reel arrive.
    const id = crypto.randomUUID();
    const optimistic: Message = {
      id,
      channel_id: channelId,
      thread_id: threadId,
      author_id: authorId,
      content: trimmed,
      created_at: new Date().toISOString(),
      edited_at: null,
      reply_to_id: replyToId,
      pinned: false,
      reactions: [],
      attachments: [],
      thread: null,
      poll: null,
      pending: true,
    };

    set((state) => ({
      messages: { ...state.messages, [view]: mergeMessages(state.messages[view] ?? [], [optimistic]) },
    }));

    const { error } = await supabase.from('messages').insert({
      id,
      channel_id: channelId,
      thread_id: threadId,
      author_id: authorId,
      content: trimmed,
      reply_to_id: replyToId,
    });

    // Les pieces jointes sont rattachees apres coup : leur politique RLS exige
    // que le message existe deja et nous appartienne.
    if (!error && attachments.length > 0) {
      const { data } = await supabase
        .from('attachments')
        .insert(attachments.map((item) => ({ ...item, message_id: id })))
        .select();

      if (data) {
        set((state) => ({
          messages: {
            ...state.messages,
            [view]: (state.messages[view] ?? []).map((message) =>
              message.id === id
                ? { ...message, attachments: data as Attachment[] }
                : message,
            ),
          },
        }));
      }
    }

    set((state) => ({
      messages: {
        ...state.messages,
        [view]: (state.messages[view] ?? []).map((message) =>
          message.id === id
            ? { ...message, pending: false, failed: Boolean(error) }
            : message,
        ),
      },
      error: error ? errorMessage(error) : state.error,
    }));
  },

  retryMessage: async (view, messageId) => {
    const message = (get().messages[view] ?? []).find((item) => item.id === messageId);
    if (!message) return;

    set((state) => ({
      messages: {
        ...state.messages,
        [view]: (state.messages[view] ?? []).map((item) =>
          item.id === messageId ? { ...item, pending: true, failed: false } : item,
        ),
      },
    }));

    const { error } = await supabase.from('messages').insert({
      id: message.id,
      channel_id: message.channel_id,
      thread_id: message.thread_id,
      author_id: message.author_id,
      content: message.content,
      reply_to_id: message.reply_to_id,
    });

    set((state) => ({
      messages: {
        ...state.messages,
        [view]: (state.messages[view] ?? []).map((item) =>
          item.id === messageId ? { ...item, pending: false, failed: Boolean(error) } : item,
        ),
      },
    }));
  },

  editMessage: async (view, messageId, content) => {
    const trimmed = content.trim();
    if (!trimmed) return;

    const previous = (get().messages[view] ?? []).find((item) => item.id === messageId);

    set((state) => ({
      messages: {
        ...state.messages,
        [view]: (state.messages[view] ?? []).map((item) =>
          item.id === messageId
            ? { ...item, content: trimmed, edited_at: new Date().toISOString() }
            : item,
        ),
      },
    }));

    const { error } = await supabase.from('messages').update({ content: trimmed }).eq('id', messageId);

    if (error && previous) {
      set((state) => ({
        messages: {
          ...state.messages,
          [view]: (state.messages[view] ?? []).map((item) =>
            item.id === messageId ? previous : item,
          ),
        },
        error: errorMessage(error),
      }));
    }
  },

  deleteMessage: async (view, messageId) => {
    const previous = get().messages[view] ?? [];

    set((state) => ({
      messages: {
        ...state.messages,
        [view]: previous.filter((item) => item.id !== messageId),
      },
    }));

    const { error } = await supabase.from('messages').delete().eq('id', messageId);
    if (error) {
      set((state) => ({ messages: { ...state.messages, [view]: previous }, error: errorMessage(error) }));
    }
  },

  toggleReaction: async (view, messageId, emoji, userId) => {
    const before = get().messages[view] ?? [];

    // Bascule locale immediate : une reaction doit repondre au clic, pas au
    // reseau.
    set((state) => ({
      messages: {
        ...state.messages,
        [view]: before.map((message) => {
          if (message.id !== messageId) return message;

          const groups = [...message.reactions];
          const index = groups.findIndex((group) => group.emoji === emoji);

          if (index === -1) {
            groups.push({ emoji, count: 1, reacted_by: [userId] });
          } else {
            const group = groups[index]!;
            const mine = group.reacted_by.includes(userId);
            const next: ReactionGroup = {
              emoji,
              count: group.count + (mine ? -1 : 1),
              reacted_by: mine
                ? group.reacted_by.filter((id) => id !== userId)
                : [...group.reacted_by, userId],
            };
            if (next.count <= 0) groups.splice(index, 1);
            else groups[index] = next;
          }

          return { ...message, reactions: groups };
        }),
      },
    }));

    const { error } = await supabase.rpc('toggle_reaction', {
      p_message_id: messageId,
      p_emoji: emoji,
    });

    if (error) {
      set((state) => ({ messages: { ...state.messages, [view]: before }, error: errorMessage(error) }));
    }
  },

  togglePin: async (view, messageId) => {
    const message = (get().messages[view] ?? []).find((item) => item.id === messageId);
    if (!message) return;

    const { error } = await supabase.rpc('set_message_pinned', {
      p_message_id: messageId,
      p_pinned: !message.pinned,
    });

    if (error) {
      set({ error: errorMessage(error) });
      return;
    }

    set((state) => ({
      messages: {
        ...state.messages,
        [view]: (state.messages[view] ?? []).map((item) =>
          item.id === messageId ? { ...item, pinned: !item.pinned } : item,
        ),
      },
    }));
  },

  /* -------------------------------------------------------------------- Fils */

  startThread: async (messageId, title) => {
    const { data, error } = await supabase.rpc('start_thread', {
      p_message_id: messageId,
      p_title: title,
    });

    if (error) {
      set({ error: errorMessage(error) });
      return null;
    }

    const thread = data as Thread;
    get().applyThread(thread);
    return thread;
  },

  setThreadResolved: async (threadId, resolved) => {
    const previous = get().threads[threadId];

    set((state) => ({
      threads: previous
        ? { ...state.threads, [threadId]: { ...previous, resolved } }
        : state.threads,
    }));

    const { error } = await supabase
      .from('threads')
      .update({
        resolved,
        resolved_at: resolved ? new Date().toISOString() : null,
      })
      .eq('id', threadId);

    if (error && previous) {
      set((state) => ({ threads: { ...state.threads, [threadId]: previous }, error: errorMessage(error) }));
    }
  },

  /* ------------------------------------------------------------------ Lecture */

  markRead: async (channelId) => {
    const current = get().readStates[channelId];
    if (current && current.unread_count === 0 && current.mention_count === 0) return;

    set((state) => ({
      readStates: {
        ...state.readStates,
        [channelId]: {
          channel_id: channelId,
          last_read_at: new Date().toISOString(),
          unread_count: 0,
          mention_count: 0,
        },
      },
    }));

    await supabase.rpc('mark_channel_read', { p_channel_id: channelId });
  },

  bumpUnread: (channelId, isMention) => {
    set((state) => {
      const current = state.readStates[channelId] ?? {
        channel_id: channelId,
        last_read_at: new Date(0).toISOString(),
        unread_count: 0,
        mention_count: 0,
      };
      return {
        readStates: {
          ...state.readStates,
          [channelId]: {
            ...current,
            unread_count: current.unread_count + 1,
            mention_count: current.mention_count + (isMention ? 1 : 0),
          },
        },
      };
    });
  },

  /* ---------------------------------------------------------- Espaces, salons */

  /** Met un message de cote pour soi seul, ou l'en retire. */
  toggleBookmark: async (messageId, note = null) => {
    const existing = get().bookmarks.find((item) => item.message_id === messageId);

    if (existing) {
      set((state) => ({
        bookmarks: state.bookmarks.filter((item) => item.message_id !== messageId),
      }));
      const { error } = await supabase.from('bookmarks').delete().eq('message_id', messageId);
      if (error) set({ error: errorMessage(error) });
      return;
    }

    const { data, error } = await supabase
      .from('bookmarks')
      .insert({ message_id: messageId, note })
      .select()
      .single();

    if (error) {
      set({ error: errorMessage(error) });
      return;
    }
    set((state) => ({ bookmarks: [data as Bookmark, ...state.bookmarks] }));
  },

  reportMessage: async (messageId, reason) => {
    const { error } = await supabase.rpc('report_message', {
      p_message_id: messageId,
      p_reason: reason,
    });

    if (error) {
      set({ error: errorMessage(error) });
      return false;
    }
    return true;
  },

  createSpace: async (name, description) => {
    const { data, error } = await supabase.rpc('create_space', {
      p_name: name,
      p_description: description ?? null,
    });

    if (error) {
      set({ error: errorMessage(error) });
      return null;
    }

    // L'espace arrive avec ses salons crees cote base : on recharge plutot que
    // de reconstruire un etat partiel a la main.
    await get().bootstrap();
    return data as Space;
  },

  joinSpace: async (inviteCode) => {
    const { data, error } = await supabase.rpc('join_space', {
      p_invite_code: inviteCode.trim().toLowerCase(),
    });

    if (error) {
      set({ error: errorMessage(error) });
      return null;
    }

    await get().bootstrap();
    return data as Space;
  },

  createChannel: async (spaceId, name, kind) => {
    const position = get().channels.filter((channel) => channel.space_id === spaceId).length;

    const { error } = await supabase
      .from('channels')
      .insert({ space_id: spaceId, name, kind, position });

    if (error) set({ error: errorMessage(error) });
  },

  /* --------------------------------------------------------------- Temps reel */

  applyIncomingMessage: async (raw, currentUserId) => {
    const view = viewKeyFor(raw.channel_id, raw.thread_id);
    const state = get();

    // Un salon jamais ouvert n'a pas de liste en memoire : inutile de la creer,
    // seul le compteur de non-lus doit bouger.
    const known = state.messages[view];
    if (known) {
      const alreadyThere = known.some((message) => message.id === raw.id);
      if (!alreadyThere) {
        const { data } = await supabase
          .from('messages')
          .select(messageSelect())
          .eq('id', raw.id)
          .maybeSingle();

        const built = toMessage((data ?? raw) as RawMessage, null);
        set((s) => ({
          messages: { ...s.messages, [view]: mergeMessages(s.messages[view] ?? [], [built]) },
        }));
      }
    }

    if (raw.author_id !== currentUserId && !raw.thread_id) {
      const me = state.profiles[currentUserId];
      const mentioned =
        me !== undefined &&
        new RegExp(`@(${me.username}|everyone|here|tous)\\b`, 'i').test(raw.content);
      get().bumpUnread(raw.channel_id, mentioned);

      // Seules les mentions declenchent une bulle. Notifier chaque message d'un
      // salon actif reviendrait a ce que l'utilisateur coupe tout au bout de
      // dix minutes.
      if (mentioned) {
        const author = state.profiles[raw.author_id];
        const channel = state.channels.find((item) => item.id === raw.channel_id);
        void notify({
          title: `${author?.display_name ?? 'Quelqu’un'} vous a mentionne`,
          body: `${channel ? `#${channel.name} · ` : ''}${preview(raw.content)}`,
          tag: raw.channel_id,
        });
      }
    }
  },

  applyMessageUpdate: (raw) => {
    const view = viewKeyFor(raw.channel_id, raw.thread_id);
    set((state) => ({
      messages: {
        ...state.messages,
        [view]: (state.messages[view] ?? []).map((message) =>
          message.id === raw.id
            ? { ...message, content: raw.content, edited_at: raw.edited_at, pinned: raw.pinned }
            : message,
        ),
      },
    }));
  },

  applyMessageDelete: (raw) => {
    const view = viewKeyFor(raw.channel_id, raw.thread_id);
    set((state) => ({
      messages: {
        ...state.messages,
        [view]: (state.messages[view] ?? []).filter((message) => message.id !== raw.id),
      },
    }));
  },

  applyReactionChange: (messageId, rows) => {
    const groups = groupReactions(rows);
    set((state) => {
      const messages = { ...state.messages };
      for (const [view, list] of Object.entries(messages)) {
        if (!list.some((message) => message.id === messageId)) continue;
        messages[view] = list.map((message) =>
          message.id === messageId ? { ...message, reactions: groups } : message,
        );
      }
      return { messages };
    });
  },

  applyThread: (thread) => {
    set((state) => {
      const messages = { ...state.messages };
      for (const [view, list] of Object.entries(messages)) {
        if (!list.some((message) => message.id === thread.root_message_id)) continue;
        messages[view] = list.map((message) =>
          message.id === thread.root_message_id ? { ...message, thread } : message,
        );
      }
      return { messages, threads: { ...state.threads, [thread.id]: thread } };
    });
  },

  applyProfile: (profile) => {
    set((state) => ({ profiles: { ...state.profiles, [profile.id]: profile } }));
  },

  applyChannel: (channel) => {
    set((state) => {
      const index = state.channels.findIndex((item) => item.id === channel.id);
      if (index === -1) return { channels: [...state.channels, channel] };
      const channels = [...state.channels];
      channels[index] = channel;
      return { channels };
    });
  },

  setTyping: (view, userId) => {
    set((state) => ({
      typing: {
        ...state.typing,
        [view]: { ...(state.typing[view] ?? {}), [userId]: Date.now() },
      },
    }));
  },

  /** Retire les indicateurs de frappe qui n'ont pas ete rafraichis. */
  pruneTyping: () => {
    const cutoff = Date.now() - 6000;
    set((state) => {
      const typing: Record<ViewKey, Record<UUID, number>> = {};
      let changed = false;

      for (const [view, users] of Object.entries(state.typing)) {
        const alive = Object.entries(users).filter(([, at]) => at > cutoff);
        if (alive.length !== Object.keys(users).length) changed = true;
        if (alive.length > 0) typing[view] = Object.fromEntries(alive);
      }

      return changed ? { typing } : {};
    });
  },

  reset: () =>
    set({
      ready: false,
      error: null,
      spaces: [],
      channels: [],
      categories: [],
      members: [],
      profiles: {},
      threads: {},
      readStates: {},
      ranks: {},
      timeouts: {},
      bookmarks: [],
      messages: {},
      hasMore: {},
      loading: {},
      typing: {},
    }),
}));

/* -------------------------------------------------------------------------- */
/* Aides                                                                       */
/* -------------------------------------------------------------------------- */

/** Charge en une requete les fils ouverts depuis les messages donnes. */
async function fetchThreadsFor(messageIds: UUID[]): Promise<Map<UUID, Thread>> {
  if (messageIds.length === 0) return new Map();

  const { data } = await supabase.from('threads').select('*').in('root_message_id', messageIds);

  return new Map(((data ?? []) as Thread[]).map((thread) => [thread.root_message_id, thread]));
}
