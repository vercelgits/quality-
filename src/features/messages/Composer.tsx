import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
} from 'react';
import { useChat } from '@/store/chat';
import { useUI } from '@/store/ui';
import { useSession } from '@/store/session';
import { sendTyping } from '@/lib/realtime';
import {
  releasePreviews,
  rejectionReason,
  toPending,
  uploadOne,
  type PendingUpload,
} from '@/lib/upload';
import { Icon } from '@/components/Icon';
import { Avatar } from '@/components/Avatar';
import { LIMITS, QUICK_REACTIONS } from '@/constants';
import { formatBytes, formatRelative } from '@/lib/time';
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
  const [uploads, setUploads] = useState<PendingUpload[]>([]);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);

  const sendMessage = useChat((state) => state.sendMessage);
  const profiles = useChat((state) => state.profiles);
  const members = useChat((state) => state.members);
  const channels = useChat((state) => state.channels);
  const messages = useChat((state) => state.messages);
  const ranks = useChat((state) => state.ranks);
  const timeouts = useChat((state) => state.timeouts);

  const profile = useSession((state) => state.profile);
  const sendOnEnter = useSession((state) => state.preferences.sendOnEnter);

  const replyingTo = useUI((state) => state.replyingTo);
  const setReplyingTo = useUI((state) => state.setReplyingTo);
  const openModal = useUI((state) => state.openModal);

  const channel = channels.find((item) => item.id === channelId);
  // Une conversation privee n'appartient a aucun espace : ni rang, ni sanction,
  // ni moderation ne s'y appliquent.
  const spaceId = channel?.space_id ?? null;
  const myRank = spaceId ? (ranks[spaceId] ?? 0) : 0;
  const timeout = spaceId ? timeouts[spaceId] : undefined;

  /* ------------------------------------------------------- Droit d'ecrire */

  /**
   * Raison qui empeche d'ecrire, s'il y en a une.
   *
   * La base refusera de toute facon l'insertion : ce test sert a l'expliquer
   * avant la frappe plutot qu'apres, par un message d'erreur.
   */
  const blocked = useMemo((): string | null => {
    if (timeout && new Date(timeout.expires_at).getTime() > Date.now()) {
      return `Vous ne pouvez pas ecrire dans cet espace ${formatRelative(timeout.expires_at)}${
        timeout.reason ? ` — ${timeout.reason}` : ''
      }.`;
    }
    if (channel?.locked && myRank < 1) {
      return 'Ce salon est verrouille par la moderation.';
    }
    return null;
  }, [timeout, channel?.locked, myRank]);

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
      members.filter((item) => item.space_id === channel.space_id).map((item) => item.user_id),
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
      const next = value.slice(0, mention.start) + `@${chosen.username} ` + value.slice(caret);

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

  /* ------------------------------------------------------------ Fichiers */

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      const incoming = [...files];
      if (incoming.length === 0) return;

      const accepted: PendingUpload[] = [];
      const refused: string[] = [];

      for (const file of incoming) {
        const reason = rejectionReason(file);
        if (reason) refused.push(reason);
        else accepted.push(toPending(file));
      }

      setUploads((current) => {
        const room = LIMITS.attachmentsPerMessage - current.length;
        if (accepted.length > room) {
          refused.push(`Dix fichiers au maximum par message.`);
        }
        return [...current, ...accepted.slice(0, Math.max(0, room))];
      });

      setNotice(refused.length > 0 ? refused.join(' ') : null);
    },
    [],
  );

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    if (event.dataTransfer.files.length > 0) addFiles(event.dataTransfer.files);
  };

  // Le compteur de profondeur evite que le survol d'un enfant fasse clignoter
  // la zone : `dragleave` se declenche aussi en entrant dans un descendant.
  const handleDragEnter = (event: DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes('Files')) return;
    dragDepth.current += 1;
    setDragging(true);
  };

  const handleDragLeave = () => {
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  };

  const removeUpload = (id: string) => {
    setUploads((current) => {
      const target = current.find((item) => item.id === id);
      if (target) releasePreviews([target]);
      return current.filter((item) => item.id !== id);
    });
  };

  // Les apercus locaux occupent de la memoire tant qu'ils ne sont pas liberes,
  // mais on ne peut pas les liberer a chaque changement de `uploads` : le
  // nettoyage de l'effet precedent revoquerait les URL des fichiers encore
  // affiches. Une reference garde la derniere liste, liberee au demontage seul.
  const uploadsRef = useRef<PendingUpload[]>([]);
  uploadsRef.current = uploads;

  useEffect(() => () => releasePreviews(uploadsRef.current), []);

  /* ------------------------------------------------------------- Redimension */

  const resize = useCallback(() => {
    const node = textareaRef.current;
    if (!node) return;
    node.style.height = 'auto';
    node.style.height = `${Math.min(node.scrollHeight, 320)}px`;
  }, []);

  useEffect(resize, [value, resize]);

  useEffect(() => {
    if (autoFocus && !blocked) textareaRef.current?.focus();
  }, [autoFocus, channelId, threadId, blocked]);

  /* ------------------------------------------------------------------ Envoi */

  const submit = useCallback(async () => {
    const trimmed = value.trim();
    if ((!trimmed && uploads.length === 0) || !profile || sending || blocked) return;

    setSending(true);

    // Les fichiers partent avant le message : un message qui apparaitrait sans
    // ses pieces jointes serait pire qu'un envoi legerement plus lent.
    const uploaded = await Promise.all(
      uploads.map((item) => uploadOne(item, channelId)),
    );

    const failed = uploaded.filter((item) => item.progress === 'error');
    if (failed.length > 0) {
      setUploads(uploaded);
      setNotice(`Echec du televersement de ${failed.length} fichier(s).`);
      setSending(false);
      return;
    }

    await sendMessage({
      channelId,
      threadId,
      content: trimmed,
      replyToId: replyingTo,
      authorId: profile.id,
      attachments: uploaded.map((item) => ({
        storage_path: item.storagePath!,
        filename: item.file.name,
        content_type: item.file.type || 'application/octet-stream',
        size: item.file.size,
        width: item.width,
        height: item.height,
      })),
    });

    releasePreviews(uploads);
    setUploads([]);
    setValue('');
    setMention(null);
    setNotice(null);
    setReplyingTo(null);
    setSending(false);
    requestAnimationFrame(resize);
  }, [
    value,
    uploads,
    profile,
    sending,
    blocked,
    channelId,
    threadId,
    replyingTo,
    sendMessage,
    setReplyingTo,
    resize,
  ]);

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
      void submit();
    }
  };

  const remaining = LIMITS.messageLength - value.length;
  const nearLimit = remaining <= 200;
  const canSend = (value.trim().length > 0 || uploads.length > 0) && !sending && !blocked;

  if (blocked) {
    return (
      <div className="composer-wrap">
        <p className="composer-blocked" role="status">
          <Icon name="mic-off" size={15} />
          {blocked}
        </p>
      </div>
    );
  }

  return (
    <div
      className={'composer-wrap' + (dragging ? ' is-dragging' : '')}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={(event) => event.preventDefault()}
      onDrop={handleDrop}
    >
      {dragging ? (
        <div className="composer-drop" aria-hidden="true">
          <Icon name="paperclip" size={22} />
          Deposez pour joindre
        </div>
      ) : null}

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

      {uploads.length > 0 ? (
        <ul className="upload-tray">
          {uploads.map((upload) => (
            <li key={upload.id} className={'upload' + (upload.progress === 'error' ? ' is-error' : '')}>
              {upload.previewUrl ? (
                <img className="upload__thumb" src={upload.previewUrl} alt="" />
              ) : (
                <span className="upload__thumb upload__thumb--file">
                  <Icon name="paperclip" size={16} />
                </span>
              )}

              <span className="upload__meta">
                <span className="upload__name truncate">{upload.file.name}</span>
                <span className="upload__size">{formatBytes(upload.file.size)}</span>
              </span>

              <button
                type="button"
                className="icon-btn"
                onClick={() => removeUpload(upload.id)}
                aria-label={`Retirer ${upload.file.name}`}
              >
                <Icon name="x" size={13} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {notice ? (
        <p className="composer-notice" role="alert">
          {notice}
        </p>
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
        <input
          ref={fileRef}
          type="file"
          multiple
          className="visually-hidden"
          onChange={(event) => {
            if (event.target.files) addFiles(event.target.files);
            event.target.value = '';
          }}
        />

        <button
          type="button"
          className="icon-btn composer__attach"
          onClick={() => fileRef.current?.click()}
          title="Joindre un fichier"
          aria-label="Joindre un fichier"
        >
          <Icon name="paperclip" size={18} />
        </button>

        <textarea
          ref={textareaRef}
          className="composer__input"
          value={value}
          rows={1}
          maxLength={LIMITS.messageLength}
          placeholder={
            placeholder ??
            (channel
              ? channel.slowmode_seconds > 0
                ? `Ecrire dans #${channel.name} — mode lent ${channel.slowmode_seconds} s`
                : `Ecrire dans #${channel.name}`
              : 'Ecrire un message')
          }
          onChange={(event) => {
            setValue(event.target.value);
            detectMention(event.target.value, event.target.selectionStart);
            if (profile) sendTyping(channelId, threadId, profile.id);
          }}
          onKeyDown={handleKeyDown}
          onClick={(event) => detectMention(value, event.currentTarget.selectionStart)}
          onPaste={(event) => {
            const files = [...event.clipboardData.files];
            if (files.length > 0) {
              event.preventDefault();
              addFiles(files);
            }
          }}
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
            onClick={() => openModal({ kind: 'poll', channelId, threadId })}
            title="Creer un sondage"
            aria-label="Creer un sondage"
          >
            <Icon name="filter" size={18} />
          </button>

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
            onClick={() => void submit()}
            disabled={!canSend}
            title="Envoyer"
            aria-label="Envoyer"
          >
            {sending ? <span className="spinner" /> : <Icon name="send" size={17} />}
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
        <span className="kbd">{sendOnEnter ? 'Entree' : 'Ctrl+Entree'}</span> envoyer ·{' '}
        <span className="kbd">Maj+Entree</span> retour a la ligne · glissez un fichier ou collez une
        image · **gras**, *italique*, `code`, ||spoiler||
      </p>
    </div>
  );
}
