import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useChat } from '@/store/chat';
import { useUI } from '@/store/ui';
import { useSession } from '@/store/session';
import { sendTyping } from '@/lib/realtime';
import { Icon } from '@/components/Icon';
import { Avatar } from '@/components/Avatar';
import { LIMITS, QUICK_REACTIONS } from '@/constants';
import type { Profile, UUID } from '@/types/db';

interface ComposerProps {
  channelId: UUID;
  threadId?: UUID | null;
  placeholder?: string;
  autoFocus?: boolean;
}

/** Etat de l'autocompletion de mention en cours de frappe. */
interface MentionQuery {
  /** Position du `@` dans le texte. */
  start: number;
  term: string;
}

export function Composer({ channelId, threadId = null, placeholder, autoFocus }: ComposerProps) {
  const [value, setValue] = useState('');
  const [mention, setMention] = useState<MentionQuery | null>(null);
  const [highlighted, setHighlighted] = useState(0);
  const [emojiOpen, setEmojiOpen] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const sendMessage = useChat((state) => state.sendMessage);
  const profiles = useChat((state) => state.profiles);
  const members = useChat((state) => state.members);
  const channels = useChat((state) => state.channels);
  const messages = useChat((state) => state.messages);

  const profile = useSession((state) => state.profile);
  const sendOnEnter = useSession((state) => state.preferences.sendOnEnter);

  const replyingTo = useUI((state) => state.replyingTo);
  const setReplyingTo = useUI((state) => state.setReplyingTo);

  const channel = channels.find((item) => item.id === channelId);

  /* --------------------------------------------------------- Message cite */

  const replySource = useMemo(() => {
    if (!replyingTo) return null;
    for (const list of Object.values(messages)) {
      const found = list.find((item) => item.id === replyingTo);
      if (found) return found;
    }
    return null;
  }, [replyingTo, messages]);

  /* ------------------------------------------------------- Autocompletion */

  const candidates = useMemo((): Profile[] => {
    if (!mention || !channel) return [];

    const spaceMemberIds = new Set(
      members
        .filter((item) => item.space_id === channel.space_id)
        .map((item) => item.user_id),
    );

    const term = mention.term.toLowerCase();

    return Object.values(profiles)
      .filter((item) => spaceMemberIds.has(item.id))
      .filter(
        (item) =>
          term.length === 0 ||
          item.username.toLowerCase().includes(term) ||
          item.display_name.toLowerCase().includes(term),
      )
      .sort((a, b) => a.username.length - b.username.length)
      .slice(0, 6);
  }, [mention, profiles, members, channel]);

  useEffect(() => setHighlighted(0), [mention?.term]);

  /**
   * Detecte si le curseur se trouve dans un `@mot` en cours de frappe.
   * On exige un debut de ligne ou une espace avant le `@` pour ne pas declencher
   * l'autocompletion au milieu d'une adresse e-mail.
   */
  const detectMention = useCallback((text: string, caret: number) => {
    const before = text.slice(0, caret);
    const match = /(?:^|\s)@([a-zA-Z0-9_.-]*)$/.exec(before);

    if (!match) {
      setMention(null);
      return;
    }
    setMention({ start: caret - match[1]!.length - 1, term: match[1]! });
  }, []);

  const applyMention = useCallback(
    (chosen: Profile) => {
      if (!mention) return;

      const node = textareaRef.current;
      const caret = node?.selectionStart ?? value.length;
      const next =
        value.slice(0, mention.start) + `@${chosen.username} ` + value.slice(caret);

      setValue(next);
      setMention(null);

      requestAnimationFrame(() => {
        const position = mention.start + chosen.username.length + 2;
        node?.focus();
        node?.setSelectionRange(position, position);
      });
    },
    [mention, value],
  );

  /* ------------------------------------------------------------- Redimension */

  const resize = useCallback(() => {
    const node = textareaRef.current;
    if (!node) return;
    node.style.height = 'auto';
    node.style.height = `${Math.min(node.scrollHeight, 320)}px`;
  }, []);

  useEffect(resize, [value, resize]);

  useEffect(() => {
    if (autoFocus) textareaRef.current?.focus();
  }, [autoFocus, channelId, threadId]);

  /* ------------------------------------------------------------------ Envoi */

  const submit = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || !profile) return;

    void sendMessage({
      channelId,
      threadId,
      content: trimmed,
      replyToId: replyingTo,
      authorId: profile.id,
    });

    setValue('');
    setMention(null);
    setReplyingTo(null);
    requestAnimationFrame(resize);
  }, [value, profile, sendMessage, channelId, threadId, replyingTo, setReplyingTo, resize]);

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (mention && candidates.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setHighlighted((index) => (index + 1) % candidates.length);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setHighlighted((index) => (index - 1 + candidates.length) % candidates.length);
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        const chosen = candidates[highlighted];
        if (chosen) applyMention(chosen);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setMention(null);
        return;
      }
    }

    if (event.key === 'Escape' && replyingTo) {
      event.preventDefault();
      setReplyingTo(null);
      return;
    }

    const wantsSend = sendOnEnter
      ? event.key === 'Enter' && !event.shiftKey
      : event.key === 'Enter' && (event.ctrlKey || event.metaKey);

    if (wantsSend) {
      event.preventDefault();
      submit();
    }
  };

  const remaining = LIMITS.messageLength - value.length;
  const nearLimit = remaining <= 200;

  return (
    <div className="composer-wrap">
      {replySource ? (
        <div className="composer-reply">
          <Icon name="reply" size={13} />
          <span className="composer-reply__label">
            Reponse a <strong>{profiles[replySource.author_id]?.display_name ?? 'Inconnu'}</strong>
          </span>
          <span className="composer-reply__text truncate">{replySource.content}</span>
          <button
            type="button"
            className="icon-btn"
            onClick={() => setReplyingTo(null)}
            aria-label="Annuler la reponse"
          >
            <Icon name="x" size={14} />
          </button>
        </div>
      ) : null}

      {mention && candidates.length > 0 ? (
        <ul className="mention-list surface" role="listbox" aria-label="Suggestions de mention">
          {candidates.map((candidate, index) => (
            <li key={candidate.id}>
              <button
                type="button"
                role="option"
                aria-selected={index === highlighted}
                className={'mention-list__item' + (index === highlighted ? ' is-active' : '')}
                onMouseEnter={() => setHighlighted(index)}
                onClick={() => applyMention(candidate)}
              >
                <Avatar profile={candidate} size={22} />
                <span className="mention-list__name">{candidate.display_name}</span>
                <span className="mention-list__handle">@{candidate.username}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="composer">
        <button
          type="button"
          className="icon-btn composer__attach"
          title="Joindre un fichier"
          aria-label="Joindre un fichier"
        >
          <Icon name="plus" size={18} />
        </button>

        <textarea
          ref={textareaRef}
          className="composer__input"
          value={value}
          rows={1}
          maxLength={LIMITS.messageLength}
          placeholder={
            placeholder ??
            (channel ? `Ecrire dans #${channel.name}` : 'Ecrire un message')
          }
          onChange={(event) => {
            setValue(event.target.value);
            detectMention(event.target.value, event.target.selectionStart);
            if (profile) sendTyping(channelId, threadId, profile.id);
          }}
          onKeyDown={handleKeyDown}
          onClick={(event) => detectMention(value, event.currentTarget.selectionStart)}
          aria-label="Message"
        />

        <div className="composer__tools">
          {nearLimit ? (
            <span className={'composer__count' + (remaining < 0 ? ' is-over' : '')}>
              {remaining}
            </span>
          ) : null}

          <button
            type="button"
            className="icon-btn"
            onClick={() => setEmojiOpen((open) => !open)}
            title="Emoji"
            aria-label="Inserer un emoji"
          >
            <Icon name="smile" size={18} />
          </button>

          <button
            type="button"
            className="icon-btn composer__send"
            onClick={submit}
            disabled={value.trim().length === 0}
            title="Envoyer"
            aria-label="Envoyer"
          >
            <Icon name="send" size={17} />
          </button>
        </div>

        {emojiOpen ? (
          <div className="emoji-pop emoji-pop--composer surface">
            {QUICK_REACTIONS.map((emoji) => (
              <button
                type="button"
                key={emoji}
                className="emoji-pop__item"
                onClick={() => {
                  setValue((current) => current + emoji);
                  setEmojiOpen(false);
                  textareaRef.current?.focus();
                }}
              >
                {emoji}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <p className="composer__hint">
        <span className="kbd">{sendOnEnter ? 'Entree' : 'Ctrl+Entree'}</span> pour envoyer ·{' '}
        <span className="kbd">Maj+Entree</span> pour un retour a la ligne · **gras**, *italique*,
        `code`, ||spoiler||
      </p>
    </div>
  );
}
