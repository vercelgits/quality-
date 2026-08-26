import { useEffect, useMemo, useState } from 'react';
import { useChat, viewKeyFor } from '@/store/chat';
import { useUI } from '@/store/ui';
import { useSession } from '@/store/session';
import { supabase } from '@/lib/supabase';
import { MessageList } from '@/features/messages/MessageList';
import { Composer } from '@/features/messages/Composer';
import { SearchPanel } from '@/features/search/SearchPanel';
import { Icon } from '@/components/Icon';
import { Avatar } from '@/components/Avatar';
import { RichText } from '@/lib/richtext';
import { formatRelative, formatTime } from '@/lib/time';
import type { Message, Profile, UUID } from '@/types/db';

/** Panneau lateral droit. Son contenu depend de l'onglet actif. */
export function SidePanel() {
  const panel = useUI((state) => state.panel);
  const setPanel = useUI((state) => state.setPanel);

  if (panel === 'none') return null;

  const titles: Record<string, string> = {
    thread: 'Fils de discussion',
    pins: 'Messages epingles',
    members: 'Membres',
    search: 'Recherche',
  };

  return (
    <aside className="side-panel">
      <header className="side-panel__header">
        <h2 className="side-panel__title">{titles[panel] ?? ''}</h2>
        <button
          type="button"
          className="icon-btn"
          onClick={() => setPanel('none')}
          aria-label="Fermer le panneau"
        >
          <Icon name="x" size={16} />
        </button>
      </header>

      {panel === 'thread' ? <ThreadPanel /> : null}
      {panel === 'pins' ? <PinsPanel /> : null}
      {panel === 'members' ? <MembersPanel /> : null}
      {panel === 'search' ? <SearchPanel /> : null}
    </aside>
  );
}

/* ========================================================================== */
/* Fils                                                                       */
/* ========================================================================== */

function ThreadPanel() {
  const activeThreadId = useUI((state) => state.activeThreadId);
  const activeChannelId = useUI((state) => state.activeChannelId);
  const openThread = useUI((state) => state.openThread);

  const threads = useChat((state) => state.threads);
  const profiles = useChat((state) => state.profiles);
  const setThreadResolved = useChat((state) => state.setThreadResolved);

  const thread = activeThreadId ? threads[activeThreadId] : null;

  // Sans fil selectionne, le panneau liste ceux du salon courant.
  const channelThreads = useMemo(
    () =>
      Object.values(threads)
        .filter((item) => item.channel_id === activeChannelId)
        .sort((a, b) => {
          if (a.resolved !== b.resolved) return a.resolved ? 1 : -1;
          return b.last_activity_at.localeCompare(a.last_activity_at);
        }),
    [threads, activeChannelId],
  );

  if (!thread) {
    return (
      <div className="side-panel__body scroll">
        {channelThreads.length === 0 ? (
          <div className="panel-empty">
            <Icon name="thread" size={26} />
            <p>Aucun fil dans ce salon.</p>
            <p className="panel-empty__hint">
              Survolez un message et cliquez sur l’icone de fil pour en ouvrir un.
              Il restera visible dans « A suivre » jusqu’a ce qu’il soit resolu.
            </p>
          </div>
        ) : (
          <ul className="thread-index">
            {channelThreads.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={'thread-index__item' + (item.resolved ? ' is-resolved' : '')}
                  onClick={() => openThread(item.id)}
                >
                  <Icon name={item.resolved ? 'check-circle' : 'thread'} size={15} />
                  <span className="thread-index__body">
                    <span className="thread-index__title truncate">{item.title}</span>
                    <span className="thread-index__meta">
                      {formatRelative(item.last_activity_at)}
                    </span>
                  </span>
                  <Icon name="chevron-right" size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  const author = profiles[thread.created_by];

  return (
    <div className="thread-panel">
      <div className="thread-panel__meta">
        <button
          type="button"
          className="btn btn--sm btn--ghost"
          onClick={() => useUI.getState().closeThread()}
        >
          <Icon name="chevron-right" size={13} />
          Tous les fils
        </button>

        <button
          type="button"
          className={'btn btn--sm' + (thread.resolved ? '' : ' btn--primary')}
          onClick={() => void setThreadResolved(thread.id, !thread.resolved)}
          title={
            thread.resolved
              ? 'Rouvrir ce fil et le remettre dans « A suivre »'
              : 'Marquer resolu et le retirer de « A suivre »'
          }
        >
          <Icon name={thread.resolved ? 'refresh' : 'check'} size={13} />
          {thread.resolved ? 'Rouvrir' : 'Marquer resolu'}
        </button>
      </div>

      <div className="thread-panel__head">
        <h3 className="thread-panel__title">{thread.title}</h3>
        <p className="thread-panel__sub">
          Ouvert par {author?.display_name ?? 'quelqu’un'} · {formatRelative(thread.created_at)}
        </p>
      </div>

      <div className="thread-panel__messages">
        <MessageList channelId={thread.channel_id} threadId={thread.id} compact />
      </div>

      <Composer
        channelId={thread.channel_id}
        threadId={thread.id}
        placeholder="Repondre dans le fil"
      />
    </div>
  );
}

/* ========================================================================== */
/* Epingles                                                                   */
/* ========================================================================== */

function PinsPanel() {
  const activeChannelId = useUI((state) => state.activeChannelId);
  const profiles = useChat((state) => state.profiles);
  const togglePin = useChat((state) => state.togglePin);

  const [pins, setPins] = useState<Message[] | null>(null);

  useEffect(() => {
    if (!activeChannelId) return;
    let cancelled = false;

    void (async () => {
      const { data } = await supabase
        .from('messages')
        .select('*')
        .eq('channel_id', activeChannelId)
        .eq('pinned', true)
        .order('created_at', { ascending: false });

      if (!cancelled) {
        setPins(
          ((data ?? []) as Message[]).map((item) => ({
            ...item,
            reactions: [],
            attachments: [],
            thread: null,
          })),
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeChannelId]);

  if (pins === null) {
    return (
      <div className="side-panel__body">
        <span className="spinner" />
      </div>
    );
  }

  if (pins.length === 0) {
    return (
      <div className="side-panel__body scroll">
        <div className="panel-empty">
          <Icon name="pin" size={26} />
          <p>Rien d’epingle ici.</p>
          <p className="panel-empty__hint">
            Epinglez les decisions et les liens utiles : ils resteront a portee de clic.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="side-panel__body scroll">
      <ul className="pin-list">
        {pins.map((pin) => {
          const author = profiles[pin.author_id];
          return (
            <li className="pin" key={pin.id}>
              <div className="pin__head">
                <Avatar profile={author} size={22} />
                <span className="pin__author">{author?.display_name ?? 'Inconnu'}</span>
                <span className="pin__time">{formatTime(pin.created_at)}</span>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() =>
                    activeChannelId && void togglePin(viewKeyFor(activeChannelId, null), pin.id)
                  }
                  title="Retirer l’epingle"
                  aria-label="Retirer l’epingle"
                >
                  <Icon name="x" size={13} />
                </button>
              </div>
              <div className="pin__body">
                <RichText content={pin.content} />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ========================================================================== */
/* Membres                                                                    */
/* ========================================================================== */

function MembersPanel() {
  const activeSpaceId = useUI((state) => state.activeSpaceId);
  const openModal = useUI((state) => state.openModal);

  const members = useChat((state) => state.members);
  const profiles = useChat((state) => state.profiles);
  const currentUserId = useSession((state) => state.profile?.id);

  const grouped = useMemo(() => {
    const inSpace = members
      .filter((member) => member.space_id === activeSpaceId)
      .map((member) => ({ member, profile: profiles[member.user_id] }))
      .filter((entry): entry is { member: typeof entry.member; profile: Profile } =>
        Boolean(entry.profile),
      );

    const online = inSpace.filter((entry) => entry.profile.status !== 'offline');
    const offline = inSpace.filter((entry) => entry.profile.status === 'offline');

    const byName = (a: { profile: Profile }, b: { profile: Profile }) =>
      a.profile.display_name.localeCompare(b.profile.display_name, 'fr');

    return { online: online.sort(byName), offline: offline.sort(byName) };
  }, [members, profiles, activeSpaceId]);

  const renderGroup = (label: string, entries: { member: { role: string }; profile: Profile }[]) =>
    entries.length === 0 ? null : (
      <section className="member-group">
        <h3 className="member-group__title">
          {label} — {entries.length}
        </h3>
        <ul>
          {entries.map(({ member, profile }) => (
            <li key={profile.id}>
              <button
                type="button"
                className="member"
                onClick={() => openModal({ kind: 'profile', userId: profile.id })}
              >
                <Avatar profile={profile} size={30} status={profile.status} showStatus />
                <span className="member__body">
                  <span className="member__name truncate">
                    {profile.display_name}
                    {profile.id === currentUserId ? ' (vous)' : ''}
                  </span>
                  {profile.custom_status ? (
                    <span className="member__status truncate">{profile.custom_status}</span>
                  ) : null}
                </span>
                {member.role !== 'member' ? (
                  <span className="member__role">
                    {member.role === 'owner' ? 'Proprietaire' : 'Admin'}
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      </section>
    );

  return (
    <div className="side-panel__body scroll">
      {renderGroup('En ligne', grouped.online)}
      {renderGroup('Hors ligne', grouped.offline)}

      {activeSpaceId ? (
        <button
          type="button"
          className="btn btn--sm btn--block"
          style={{ marginTop: 'var(--space-5)' }}
          onClick={() => openModal({ kind: 'invite', spaceId: activeSpaceId })}
        >
          <Icon name="link" size={14} />
          Inviter quelqu’un
        </button>
      ) : null}
    </div>
  );
}

export type { UUID };
