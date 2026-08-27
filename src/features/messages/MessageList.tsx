import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useChat, viewKeyFor } from '@/store/chat';
import { useUI } from '@/store/ui';
import { useSession } from '@/store/session';
import { MessageItem } from './MessageItem';
import { Icon } from '@/components/Icon';
import { Avatar } from '@/components/Avatar';
import { canGroup, formatDayLabel, isSameDay } from '@/lib/time';
import type { RichTextContext } from '@/lib/richtext';
import type { Message, Profile, UUID } from '@/types/db';

interface MessageListProps {
  channelId: UUID;
  threadId?: UUID | null;
  /** Masque l'etat vide illustre, dans le panneau lateral d'un fil. */
  compact?: boolean;
}

export function MessageList({ channelId, threadId = null, compact = false }: MessageListProps) {
  const view = viewKeyFor(channelId, threadId);

  const messages = useChat((state) => state.messages[view]);
  const loading = useChat((state) => state.loading[view] ?? false);
  const hasMore = useChat((state) => state.hasMore[view] ?? false);
  const typingUsers = useChat((state) => state.typing[view]);
  const profiles = useChat((state) => state.profiles);
  const channels = useChat((state) => state.channels);
  const members = useChat((state) => state.members);
  const readStates = useChat((state) => state.readStates);

  const loadMessages = useChat((state) => state.loadMessages);
  const loadOlder = useChat((state) => state.loadOlder);
  const editMessage = useChat((state) => state.editMessage);
  const deleteMessage = useChat((state) => state.deleteMessage);
  const toggleReaction = useChat((state) => state.toggleReaction);
  const togglePin = useChat((state) => state.togglePin);
  const startThread = useChat((state) => state.startThread);
  const retryMessage = useChat((state) => state.retryMessage);
  const markRead = useChat((state) => state.markRead);
  const toggleBookmark = useChat((state) => state.toggleBookmark);
  const bookmarks = useChat((state) => state.bookmarks);

  const profile = useSession((state) => state.profile);
  const showTimestamps = useSession((state) => state.preferences.showTimestamps);

  const setReplyingTo = useUI((state) => state.setReplyingTo);
  const editingId = useUI((state) => state.editingId);
  const setEditingId = useUI((state) => state.setEditingId);
  const openThread = useUI((state) => state.openThread);
  const openModal = useUI((state) => state.openModal);

  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomAnchorRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const previousHeight = useRef(0);
  const [showJump, setShowJump] = useState(false);

  const channel = channels.find((item) => item.id === channelId);
  const list = useMemo(() => messages ?? [], [messages]);

  /** Instant de derniere lecture, fige a l'ouverture pour placer le separateur. */
  const [unreadBoundary] = useState(() => readStates[channelId]?.last_read_at ?? null);

  /* ------------------------------------------------------------ Chargement */

  useEffect(() => {
    if (messages === undefined) void loadMessages(channelId, threadId);
  }, [channelId, threadId, messages, loadMessages]);

  useEffect(() => {
    if (!threadId) void markRead(channelId);
  }, [channelId, threadId, list.length, markRead]);

  /* --------------------------------------------------------------- Defilement */

  const isNearBottom = useCallback((): boolean => {
    const node = scrollRef.current;
    if (!node) return true;
    return node.scrollHeight - node.scrollTop - node.clientHeight < 120;
  }, []);

  const handleScroll = useCallback(() => {
    const node = scrollRef.current;
    if (!node) return;

    stickToBottom.current = isNearBottom();
    setShowJump(!stickToBottom.current);

    // Chargement de l'historique quand on approche du haut.
    if (node.scrollTop < 240 && hasMore && !loading) {
      previousHeight.current = node.scrollHeight;
      void loadOlder(channelId, threadId);
    }
  }, [channelId, threadId, hasMore, loading, loadOlder, isNearBottom]);

  /**
   * Apres l'ajout de messages, deux comportements opposes selon l'endroit :
   * en bas on suit le flux, en haut on garde l'oeil sur la ligne lue, sinon
   * charger l'historique deplacerait le texte sous le curseur.
   */
  useLayoutEffect(() => {
    const node = scrollRef.current;
    if (!node) return;

    if (previousHeight.current > 0) {
      node.scrollTop += node.scrollHeight - previousHeight.current;
      previousHeight.current = 0;
      return;
    }

    if (stickToBottom.current) {
      bottomAnchorRef.current?.scrollIntoView({ block: 'end' });
    }
  }, [list]);

  /* ------------------------------------------------------------------ Contexte */

  const richTextContext: RichTextContext = useMemo(
    () => ({
      usersByUsername: new Map(
        Object.values(profiles).map((item) => [item.username, item]),
      ),
      channelsByName: new Map(
        channels
          .filter((item) => item.space_id === channel?.space_id)
          .map((item) => [item.name.toLowerCase(), item]),
      ),
      currentUsername: profile?.username ?? null,
      onUserClick: (userId) => openModal({ kind: 'profile', userId }),
      onChannelClick: (id) => useUI.getState().selectChannel(id),
    }),
    [profiles, channels, channel?.space_id, profile?.username, openModal],
  );

  const canManage = useMemo(() => {
    if (!profile || !channel) return false;
    const membership = members.find(
      (item) => item.space_id === channel.space_id && item.user_id === profile.id,
    );
    return membership?.role === 'owner' || membership?.role === 'admin';
  }, [members, profile, channel]);

  const byId = useMemo(() => new Map(list.map((item) => [item.id, item])), [list]);

  const bookmarked = useMemo(
    () => new Set(bookmarks.map((item) => item.message_id)),
    [bookmarks],
  );

  const jumpTo = useCallback((messageId: UUID) => {
    const node = document.getElementById(`message-${messageId}`);
    if (!node) return;
    node.scrollIntoView({ behavior: 'smooth', block: 'center' });
    node.classList.add('is-highlighted');
    window.setTimeout(() => node.classList.remove('is-highlighted'), 1600);
  }, []);

  /**
   * Gestionnaires stabilises.
   *
   * `MessageItem` est memoise, mais une fonction fleche ecrite dans le JSX est
   * recreee a chaque rendu : la comparaison de props echouait donc toujours et
   * les cinquante lignes visibles se repeignaient a chaque frappe dans le
   * compositeur. Les figer rend la memoisation effective.
   */
  const handleSubmitEdit = useCallback(
    (id: UUID, content: string) => {
      void editMessage(view, id, content);
      setEditingId(null);
    },
    [editMessage, view, setEditingId],
  );

  const handleDelete = useCallback(
    (id: UUID) => void deleteMessage(view, id),
    [deleteMessage, view],
  );

  const handleReact = useCallback(
    (id: UUID, emoji: string) => {
      if (profile) void toggleReaction(view, id, emoji, profile.id);
    },
    [toggleReaction, view, profile],
  );

  const handlePin = useCallback((id: UUID) => void togglePin(view, id), [togglePin, view]);

  const handleRetry = useCallback(
    (id: UUID) => void retryMessage(view, id),
    [retryMessage, view],
  );

  const handleBookmark = useCallback(
    (id: UUID) => void toggleBookmark(id),
    [toggleBookmark],
  );

  const handleReport = useCallback(
    (id: UUID) => openModal({ kind: 'report', messageId: id }),
    [openModal],
  );

  const handleStartThread = useCallback(
    (messageId: UUID) => {
      const source = byId.get(messageId);
      const title = source ? source.content.slice(0, 80) : 'Nouveau fil';
      void startThread(messageId, title).then((thread) => {
        if (thread) openThread(thread.id);
      });
    },
    [byId, startThread, openThread],
  );

  /* ---------------------------------------------------------------- Rendu */

  if (messages === undefined && loading) {
    return (
      <div className="messages messages--loading">
        <span className="spinner" />
      </div>
    );
  }

  const typingIds = Object.keys(typingUsers ?? {}).filter((id) => id !== profile?.id);

  return (
    <div className="messages">
      <div className="messages__scroll scroll" ref={scrollRef} onScroll={handleScroll}>
        {hasMore ? (
          <div className="messages__more">
            {loading ? (
              <span className="spinner" />
            ) : (
              <button type="button" className="btn btn--sm btn--ghost" onClick={() => void loadOlder(channelId, threadId)}>
                Charger les messages plus anciens
              </button>
            )}
          </div>
        ) : list.length > 0 && !compact ? (
          <ChannelIntro name={channel?.name ?? ''} topic={channel?.topic ?? null} />
        ) : null}

        {list.length === 0 && !loading ? (
          compact ? (
            <p className="messages__empty-compact">Aucune reponse pour l’instant.</p>
          ) : (
            <ChannelIntro name={channel?.name ?? ''} topic={channel?.topic ?? null} empty />
          )
        ) : null}

        <div className="messages__items">
          {list.map((message, index) => {
            const previous = index > 0 ? list[index - 1] : undefined;
            const author = profiles[message.author_id];

            const newDay = !previous || !isSameDay(previous.created_at, message.created_at);

            const crossesUnread =
              unreadBoundary !== null &&
              message.author_id !== profile?.id &&
              message.created_at > unreadBoundary &&
              (!previous || previous.created_at <= unreadBoundary);

            const grouped =
              !newDay &&
              !crossesUnread &&
              previous !== undefined &&
              previous.author_id === message.author_id &&
              previous.reply_to_id === null &&
              message.reply_to_id === null &&
              canGroup(previous.created_at, message.created_at);

            const replySource = message.reply_to_id ? byId.get(message.reply_to_id) : undefined;

            return (
              <div key={message.id}>
                {newDay ? (
                  <div className="day-divider">
                    <span className="day-divider__label">{formatDayLabel(message.created_at)}</span>
                  </div>
                ) : null}

                {crossesUnread ? (
                  <div className="unread-divider">
                    <span className="unread-divider__label">Nouveaux messages</span>
                  </div>
                ) : null}

                <MessageItem
                  message={message}
                  author={author}
                  currentUserId={profile?.id ?? ''}
                  grouped={grouped}
                  replyTo={
                    replySource
                      ? { message: replySource, author: profiles[replySource.author_id] }
                      : null
                  }
                  showTimestamp={showTimestamps}
                  editing={editingId === message.id}
                  richTextContext={richTextContext}
                  canManage={canManage}
                  profiles={profiles}
                  onReply={setReplyingTo}
                  onEdit={setEditingId}
                  onSubmitEdit={handleSubmitEdit}
                  onDelete={handleDelete}
                  onReact={handleReact}
                  onPin={handlePin}
                  onOpenThread={openThread}
                  onStartThread={handleStartThread}
                  onRetry={handleRetry}
                  onJumpTo={jumpTo}
                  onBookmark={handleBookmark}
                  onReport={handleReport}
                  bookmarked={bookmarked.has(message.id)}
                />
              </div>
            );
          })}
        </div>

        <div ref={bottomAnchorRef} />
      </div>

      {typingIds.length > 0 ? (
        <TypingIndicator userIds={typingIds} profiles={profiles} />
      ) : null}

      {showJump ? (
        <button
          type="button"
          className="jump-to-bottom"
          onClick={() => {
            stickToBottom.current = true;
            bottomAnchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
          }}
        >
          <Icon name="arrow-down" size={14} />
          Revenir en bas
        </button>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function ChannelIntro({
  name,
  topic,
  empty = false,
}: {
  name: string;
  topic: string | null;
  empty?: boolean;
}) {
  return (
    <div className="channel-intro">
      <span className="channel-intro__mark" aria-hidden="true">
        <Icon name="hash" size={26} />
      </span>
      <h2 className="channel-intro__title">Bienvenue dans #{name}</h2>
      <p className="channel-intro__body">
        {topic ??
          (empty
            ? 'Rien n’a encore ete dit ici. Lancez la conversation.'
            : 'C’est le tout debut de ce salon.')}
      </p>
    </div>
  );
}

function TypingIndicator({
  userIds,
  profiles,
}: {
  userIds: string[];
  profiles: Record<UUID, Profile>;
}) {
  const names = userIds.map((id) => profiles[id]?.display_name ?? 'Quelqu’un');

  const label =
    names.length === 1
      ? `${names[0]} ecrit`
      : names.length === 2
        ? `${names[0]} et ${names[1]} ecrivent`
        : `${names.length} personnes ecrivent`;

  return (
    <div className="typing" aria-live="polite">
      <span className="typing__dots" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      <span className="typing__label">{label}…</span>
    </div>
  );
}

/** Reexporte pour le panneau de fil, qui affiche le message racine en tete. */
export function RootMessagePreview({
  message,
  author,
}: {
  message: Message;
  author: Profile | undefined;
}) {
  return (
    <div className="thread-root">
      <Avatar profile={author} size={28} />
      <div className="thread-root__content">
        <span className="thread-root__author">{author?.display_name ?? 'Inconnu'}</span>
        <p className="thread-root__text">{message.content}</p>
      </div>
    </div>
  );
}
