import { memo, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Avatar, AvatarStack } from '@/components/Avatar';
import { Icon } from '@/components/Icon';
import { RichText, type RichTextContext } from '@/lib/richtext';
import { formatTime, formatFull, formatRelative } from '@/lib/time';
import { QUICK_REACTIONS } from '@/constants';
import { EmojiPicker } from '@/components/EmojiPicker';
import { PollCard } from '@/features/polls/PollCard';
import { AttachmentList } from './AttachmentList';
import { LinkPreviews } from './LinkPreview';
import type { Message, Profile, UUID } from '@/types/db';
import { useContextMenu } from '@/components/ContextMenu';
import { MessageContextMenu } from './MessageContextMenu';
import { useUI } from '@/store/ui';
import { useSession } from '@/store/session';

interface MessageItemProps {
  message: Message;
  author: Profile | undefined;
  currentUserId: UUID;
  /** Message replie sous le precedent : ni avatar ni nom repetes. */
  grouped: boolean;
  /** Message cite, pour l'apercu en haut de ligne. */
  replyTo: { message: Message; author: Profile | undefined } | null;
  showTimestamp: boolean;
  editing: boolean;
  richTextContext: RichTextContext;
  canManage: boolean;
  profiles: Record<UUID, Profile>;

  onReply: (id: UUID) => void;
  onEdit: (id: UUID | null) => void;
  onSubmitEdit: (id: UUID, content: string) => void;
  onDelete: (id: UUID) => void;
  onReact: (id: UUID, emoji: string) => void;
  onPin: (id: UUID) => void;
  onOpenThread: (threadId: UUID) => void;
  onStartThread: (id: UUID) => void;
  onRetry: (id: UUID) => void;
  onJumpTo?: (id: UUID) => void;
  onBookmark: (id: UUID) => void;
  onReport: (id: UUID) => void;
  /** Vrai si l'utilisateur a deja mis ce message de cote. */
  bookmarked: boolean;
}

function MessageItemInner({
  message,
  author,
  currentUserId,
  grouped,
  replyTo,
  showTimestamp,
  editing,
  richTextContext,
  canManage,
  profiles,
  onReply,
  onEdit,
  onSubmitEdit,
  onDelete,
  onReact,
  onPin,
  onOpenThread,
  onStartThread,
  onRetry,
  onJumpTo,
  onBookmark,
  onReport,
  bookmarked,
}: MessageItemProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [draft, setDraft] = useState(message.content);
  const editRef = useRef<HTMLTextAreaElement>(null);
  const menu = useContextMenu();
  const openModal = useUI((state) => state.openModal);
  const showLinkPreviews = useSession((state) => state.preferences.showLinkPreviews);

  const isMine = message.author_id === currentUserId;
  const mentionsMe =
    richTextContext.currentUsername !== null &&
    new RegExp(`@(${richTextContext.currentUsername}|everyone|here|tous)\\b`, 'i').test(
      message.content,
    );

  useEffect(() => {
    if (!editing) return;
    setDraft(message.content);
    const node = editRef.current;
    if (node) {
      node.focus();
      node.setSelectionRange(node.value.length, node.value.length);
    }
  }, [editing, message.content]);

  const handleEditKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onEdit(null);
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      const trimmed = draft.trim();
      if (trimmed && trimmed !== message.content) onSubmitEdit(message.id, trimmed);
      else onEdit(null);
    }
  };

  return (
    <article
      className={
        'message' +
        (grouped ? ' is-grouped' : '') +
        (mentionsMe ? ' is-mention' : '') +
        (message.pending ? ' is-pending' : '') +
        (message.failed ? ' is-failed' : '')
      }
      id={`message-${message.id}`}
      data-message-id={message.id}
      onContextMenu={menu.open}
    >
      {menu.position ? (
        <MessageContextMenu
          message={message}
          position={menu.position}
          onClose={menu.close}
          mine={message.author_id === currentUserId}
          canManage={canManage}
          bookmarked={bookmarked}
          onReply={onReply}
          onEdit={onEdit}
          onDelete={onDelete}
          onReact={onReact}
          onPin={onPin}
          onStartThread={onStartThread}
          onBookmark={onBookmark}
          onReport={onReport}
          onOpenAuthor={() =>
            author && openModal({ kind: 'profile', userId: author.id })
          }
        />
      ) : null}
      {replyTo ? (
        <button
          type="button"
          className="message__replied"
          onClick={() => onJumpTo?.(replyTo.message.id)}
          title="Aller au message cite"
        >
          <Icon name="reply" size={12} />
          <Avatar profile={replyTo.author} size={16} />
          <span className="message__replied-author">
            {replyTo.author?.display_name ?? 'Inconnu'}
          </span>
          <span className="message__replied-text truncate">{replyTo.message.content}</span>
        </button>
      ) : null}

      <div className="message__body">
        <div className="message__gutter">
          {grouped ? (
            showTimestamp ? (
              <time className="message__gutter-time" dateTime={message.created_at}>
                {formatTime(message.created_at)}
              </time>
            ) : null
          ) : (
            // Clic gauche : le profil. Clic droit : les actions. Un visage se
            // clique pour voir a qui on parle — c'est le geste qu'on tente en
            // premier ; les actions restent la ou on les cherche ailleurs dans
            // l'application.
            <button
              type="button"
              className="message__avatar-button"
              onClick={() => author && openModal({ kind: 'profile', userId: author.id })}
              title={author ? `Voir le profil de ${author.display_name}` : 'Profil'}
              aria-label={author ? `Voir le profil de ${author.display_name}` : 'Profil'}
            >
              <Avatar profile={author} size={undefined} />
            </button>
          )}
        </div>

        <div className="message__content">
          {!grouped ? (
            <header className="message__header">
              <button
                type="button"
                className="message__author"
                onClick={() => author && openModal({ kind: 'profile', userId: author.id })}
                title={author ? `Voir le profil de ${author.display_name}` : undefined}
              >
                {author?.display_name ?? 'Compte supprime'}
              </button>
              <time
                className="message__time"
                dateTime={message.created_at}
                title={formatFull(message.created_at)}
              >
                {formatTime(message.created_at)}
              </time>
              {message.pinned ? (
                <span className="message__flag" title="Message epingle">
                  <Icon name="pin" size={11} />
                </span>
              ) : null}
            </header>
          ) : null}

          {editing ? (
            <div className="message__editor">
              <textarea
                ref={editRef}
                className="input message__editor-input"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={handleEditKey}
                rows={Math.min(10, draft.split('\n').length + 1)}
              />
              <p className="message__editor-hint">
                <span className="kbd">Echap</span> pour annuler ·{' '}
                <span className="kbd">Entree</span> pour enregistrer
              </p>
            </div>
          ) : (
            <>
              <RichText content={message.content} context={richTextContext} />
              {message.edited_at ? (
                <span className="message__edited" title={formatFull(message.edited_at)}>
                  (modifie)
                </span>
              ) : null}
            </>
          )}

          {!editing && showLinkPreviews ? <LinkPreviews content={message.content} /> : null}

          {message.poll ? <PollCard poll={message.poll} /> : null}

          <AttachmentList attachments={message.attachments} />

          {message.reactions.length > 0 ? (
            <ul className="reactions">
              {message.reactions.map((group) => {
                const mine = group.reacted_by.includes(currentUserId);
                const names = group.reacted_by
                  .map((id) => profiles[id]?.display_name ?? 'Quelqu’un')
                  .slice(0, 8)
                  .join(', ');

                return (
                  <li key={group.emoji}>
                    <button
                      type="button"
                      className={'reaction' + (mine ? ' is-mine' : '')}
                      onClick={() => onReact(message.id, group.emoji)}
                      title={`${names} a reagi avec ${group.emoji}`}
                      aria-pressed={mine}
                    >
                      <span className="reaction__emoji">{group.emoji}</span>
                      <span className="reaction__count">{group.count}</span>
                    </button>
                  </li>
                );
              })}
              <li>
                <button
                  type="button"
                  className="reaction reaction--add"
                  onClick={() => setPickerOpen((open) => !open)}
                  aria-label="Ajouter une reaction"
                >
                  <Icon name="smile" size={14} />
                </button>
              </li>
            </ul>
          ) : null}

          {message.thread ? (
            <button
              type="button"
              className={'thread-preview' + (message.thread.resolved ? ' is-resolved' : '')}
              onClick={() => onOpenThread(message.thread!.id)}
            >
              <Icon name={message.thread.resolved ? 'check-circle' : 'thread'} size={14} />
              <span className="thread-preview__title truncate">{message.thread.title}</span>
              <AvatarStack
                profiles={[profiles[message.thread.created_by]]}
                size={16}
                max={3}
              />
              <span className="thread-preview__meta">
                {message.thread.resolved ? 'Resolu' : 'Ouvert'} ·{' '}
                {formatRelative(message.thread.last_activity_at)}
              </span>
              <Icon name="chevron-right" size={13} />
            </button>
          ) : null}

          {message.failed ? (
            <div className="message__failure" role="alert">
              <span>L’envoi a echoue.</span>
              <button type="button" className="btn btn--sm" onClick={() => onRetry(message.id)}>
                <Icon name="refresh" size={12} />
                Reessayer
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {!editing ? (
        <div className="message__actions" role="toolbar" aria-label="Actions du message">
          {QUICK_REACTIONS.slice(0, 3).map((emoji) => (
            <button
              type="button"
              key={emoji}
              className="message__action message__action--emoji"
              onClick={() => onReact(message.id, emoji)}
              title={`Reagir avec ${emoji}`}
            >
              {emoji}
            </button>
          ))}

          <button
            type="button"
            className="message__action"
            onClick={() => setPickerOpen((open) => !open)}
            title="Ajouter une reaction"
          >
            <Icon name="smile" size={15} />
          </button>

          <button
            type="button"
            className="message__action"
            onClick={() => onReply(message.id)}
            title="Repondre"
          >
            <Icon name="reply" size={15} />
          </button>

          {!message.thread && !message.thread_id ? (
            <button
              type="button"
              className="message__action"
              onClick={() => onStartThread(message.id)}
              title="Ouvrir un fil"
            >
              <Icon name="thread" size={15} />
            </button>
          ) : null}

          <button
            type="button"
            className="message__action"
            onClick={() => onPin(message.id)}
            title={message.pinned ? 'Retirer l’epingle' : 'Epingler'}
          >
            <Icon name="pin" size={15} />
          </button>

          <button
            type="button"
            className={'message__action' + (bookmarked ? ' is-active' : '')}
            onClick={() => onBookmark(message.id)}
            title={bookmarked ? 'Retirer des sauvegardes' : 'Sauvegarder pour moi'}
            aria-pressed={bookmarked}
          >
            <Icon name="inbox" size={15} />
          </button>

          {!isMine ? (
            <button
              type="button"
              className="message__action"
              onClick={() => onReport(message.id)}
              title="Signaler a la moderation"
            >
              <Icon name="filter" size={15} />
            </button>
          ) : null}

          {isMine ? (
            <button
              type="button"
              className="message__action"
              onClick={() => onEdit(message.id)}
              title="Modifier"
            >
              <Icon name="edit" size={15} />
            </button>
          ) : null}

          {isMine || canManage ? (
            <button
              type="button"
              className="message__action message__action--danger"
              onClick={() => onDelete(message.id)}
              title="Supprimer"
            >
              <Icon name="trash" size={15} />
            </button>
          ) : null}
        </div>
      ) : null}

      {pickerOpen ? (
        <div className="message__picker">
          <EmojiPicker
            align="right"
            onClose={() => setPickerOpen(false)}
            onPick={(char) => {
              onReact(message.id, char);
              setPickerOpen(false);
            }}
          />
        </div>
      ) : null}
    </article>
  );
}

/**
 * Une liste de messages se re-rend a chaque frappe dans le compositeur. Sans
 * memoisation, chaque caractere tape repeindrait les cinquante lignes visibles.
 */
export const MessageItem = memo(MessageItemInner);
