import { useEffect, useState } from 'react';
import { Modal } from '@/components/Modal';
import { Icon } from '@/components/Icon';
import { Avatar } from '@/components/Avatar';
import { supabase } from '@/lib/supabase';
import { useChat } from '@/store/chat';
import { useUI } from '@/store/ui';
import { RichText } from '@/lib/richtext';
import { formatRelative } from '@/lib/time';
import type { MessageRow } from '@/types/db';

interface SavedMessage extends MessageRow {
  note: string | null;
  saved_at: string;
  channel_name: string;
}

/**
 * Messages mis de cote.
 *
 * Discord n'a que l'epinglage, qui est collectif : impossible de garder un
 * message pour soi sans l'imposer a tout le salon. C'est pourtant le geste le
 * plus courant — retrouver plus tard une adresse, une decision, un lien.
 */
export function BookmarksModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const bookmarks = useChat((state) => state.bookmarks);
  const toggleBookmark = useChat((state) => state.toggleBookmark);
  const profiles = useChat((state) => state.profiles);
  const channels = useChat((state) => state.channels);

  const selectChannel = useUI((state) => state.selectChannel);
  const selectSpace = useUI((state) => state.selectSpace);

  const [rows, setRows] = useState<SavedMessage[] | null>(null);

  useEffect(() => {
    if (!open) return;

    if (bookmarks.length === 0) {
      setRows([]);
      return;
    }

    let cancelled = false;

    void (async () => {
      // Les signets ne stockent qu'un identifiant : le contenu est relu ici,
      // ce qui garantit d'afficher la derniere version du message et non une
      // copie figee au moment de l'enregistrement.
      const { data } = await supabase
        .from('messages')
        .select('*')
        .in(
          'id',
          bookmarks.map((item) => item.message_id),
        );

      if (cancelled) return;

      const byId = new Map((data ?? []).map((row) => [(row as MessageRow).id, row as MessageRow]));

      setRows(
        bookmarks
          .map((bookmark) => {
            const message = byId.get(bookmark.message_id);
            if (!message) return null;
            const channel = channels.find((item) => item.id === message.channel_id);
            return {
              ...message,
              note: bookmark.note,
              saved_at: bookmark.created_at,
              channel_name: channel?.name ?? 'salon inconnu',
            } satisfies SavedMessage;
          })
          .filter((row): row is SavedMessage => row !== null),
      );
    })();

    return () => {
      cancelled = true;
    };
  }, [open, bookmarks, channels]);

  const jumpTo = (message: SavedMessage) => {
    const channel = channels.find((item) => item.id === message.channel_id);
    if (!channel) return;

    selectSpace(channel.space_id);
    selectChannel(channel.id);
    onClose();

    window.setTimeout(() => {
      document
        .getElementById(`message-${message.id}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 400);
  };

  return (
    <Modal
      open={open}
      title="Messages sauvegardes"
      description="Visibles de vous seul, contrairement aux epingles."
      onClose={onClose}
      width={600}
    >
      {rows === null ? (
        <div className="mod-loading">
          <span className="spinner" />
        </div>
      ) : rows.length === 0 ? (
        <div className="panel-empty">
          <Icon name="inbox" size={26} />
          <p>Aucun message sauvegarde.</p>
          <p className="panel-empty__hint">
            Survolez un message et cliquez sur l’icone de signet pour le mettre de cote.
          </p>
        </div>
      ) : (
        <ul className="saved-list">
          {rows.map((row) => (
            <li key={row.id} className="saved">
              <div className="saved__head">
                <Avatar profile={profiles[row.author_id]} size={22} />
                <span className="saved__author">
                  {profiles[row.author_id]?.display_name ?? 'Inconnu'}
                </span>
                <span className="saved__channel">#{row.channel_name}</span>
                <span className="saved__time">{formatRelative(row.saved_at)}</span>

                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => void toggleBookmark(row.id)}
                  title="Retirer des sauvegardes"
                  aria-label="Retirer des sauvegardes"
                >
                  <Icon name="x" size={13} />
                </button>
              </div>

              <button type="button" className="saved__body" onClick={() => jumpTo(row)}>
                <RichText content={row.content} />
              </button>

              {row.note ? <p className="saved__note">{row.note}</p> : null}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
