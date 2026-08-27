import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useFriends, matchProfile } from '@/store/friends';
import { useSession } from '@/store/session';
import { useChat } from '@/store/chat';
import { useUI } from '@/store/ui';
import { Icon } from '@/components/Icon';
import { Avatar } from '@/components/Avatar';
import type { FriendLink } from '@/types/db';

/**
 * Page des amis.
 *
 * Les quatre listes vivent derriere des onglets plutot que sur une seule page :
 * on vient ici pour une raison precise — repondre a une demande, ou trouver
 * quelqu'un a qui ecrire — et tout empiler obligerait a faire defiler pour
 * atteindre la partie qui interesse.
 */

type Tab = 'online' | 'all' | 'pending' | 'blocked' | 'add';

const TABS: { value: Tab; label: string }[] = [
  { value: 'online', label: 'En ligne' },
  { value: 'all', label: 'Tous' },
  { value: 'pending', label: 'En attente' },
  { value: 'blocked', label: 'Bloques' },
];

export function FriendsPage() {
  const load = useFriends((state) => state.load);
  const subscribe = useFriends((state) => state.subscribe);
  const loading = useFriends((state) => state.loading);
  const error = useFriends((state) => state.error);

  const friends = useFriends((state) => state.friends);
  const incoming = useFriends((state) => state.incoming);
  const outgoing = useFriends((state) => state.outgoing);
  const blocked = useFriends((state) => state.blocked);
  const profiles = useFriends((state) => state.profiles);

  const userId = useSession((state) => state.session?.user.id);

  const [tab, setTab] = useState<Tab>('online');
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!userId) return;
    void load();
    return subscribe(userId);
  }, [userId, load, subscribe]);

  const online = useMemo(
    () =>
      friends.filter((link) => {
        const status = profiles[link.user_id]?.status;
        return status !== undefined && status !== 'offline';
      }),
    [friends, profiles],
  );

  const filter = (list: FriendLink[]) =>
    list.filter((link) => matchProfile(profiles[link.user_id], query));

  const pendingCount = incoming.length;

  const shown =
    tab === 'online'
      ? filter(online)
      : tab === 'all'
        ? filter(friends)
        : tab === 'blocked'
          ? filter(blocked)
          : [];

  return (
    <div className="friends">
      <header className="friends__bar">
        <span className="friends__brand">
          <Icon name="users" size={20} />
          Amis
        </span>

        <div className="friends__tabs" role="tablist" aria-label="Listes d’amis">
          {TABS.map((entry) => (
            <button
              key={entry.value}
              type="button"
              role="tab"
              aria-selected={tab === entry.value}
              className={
                'friends__tab friends__tab--' +
                entry.value +
                (tab === entry.value ? ' is-active' : '')
              }
              onClick={() => setTab(entry.value)}
            >
              {entry.label}
              {entry.value === 'pending' && pendingCount > 0 ? (
                <span className="friends__count">{pendingCount}</span>
              ) : null}
            </button>
          ))}
        </div>

        <button
          type="button"
          role="tab"
          aria-selected={tab === 'add'}
          className={'friends__add' + (tab === 'add' ? ' is-active' : '')}
          onClick={() => setTab('add')}
        >
          <Icon name="user-plus" size={15} />
          Ajouter un ami
        </button>
      </header>

      {tab === 'add' ? (
        <AddFriend />
      ) : (
        <div className="friends__body">
          <div className="friends__search">
            <Icon name="search" size={15} />
            <input
              type="search"
              className="friends__field"
              placeholder="Rechercher un ami"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="Rechercher un ami"
            />
            {query ? (
              <button
                type="button"
                className="friends__clear"
                onClick={() => setQuery('')}
                aria-label="Effacer la recherche"
              >
                <Icon name="x" size={14} />
              </button>
            ) : null}
          </div>

          {error ? (
            <p className="friends__error" role="alert">
              {error}
            </p>
          ) : null}

          {loading && friends.length === 0 ? (
            <p className="friends__loading">
              <span className="spinner" />
              Chargement…
            </p>
          ) : tab === 'pending' ? (
            <PendingLists incoming={filter(incoming)} outgoing={filter(outgoing)} query={query} />
          ) : (
            <FriendList
              entries={shown}
              tab={tab}
              query={query}
              total={
                tab === 'online' ? online.length : tab === 'blocked' ? blocked.length : friends.length
              }
            />
          )}
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Listes                                                                      */
/* -------------------------------------------------------------------------- */

function FriendList({
  entries,
  tab,
  query,
  total,
}: {
  entries: FriendLink[];
  tab: Tab;
  query: string;
  total: number;
}) {
  const label = tab === 'online' ? 'En ligne' : tab === 'blocked' ? 'Bloques' : 'Tous les amis';

  if (entries.length === 0) {
    // Une liste vide parce qu'on filtre n'est pas une liste vide : proposer
    // « ajoutez un ami » a quelqu'un qui vient de taper trois lettres serait a
    // cote du sujet.
    return total > 0 && query !== '' ? (
      <Empty
        icon="search"
        title="Aucun resultat"
        hint={`Personne ne correspond a « ${query} » dans cette liste.`}
      />
    ) : tab === 'blocked' ? (
      <Empty
        icon="shield"
        title="Personne de bloque"
        hint="Les personnes que vous bloquez ne peuvent plus vous ecrire, et n’en sont pas averties."
      />
    ) : tab === 'online' ? (
      <Empty
        icon="users"
        title="Personne en ligne"
        hint="Vos amis apparaitront ici des qu’ils se connecteront."
      />
    ) : (
      <Empty
        icon="user-plus"
        title="Pas encore d’amis"
        hint="Ajoutez quelqu’un avec son pseudo depuis l’onglet « Ajouter un ami »."
      />
    );
  }

  return (
    <>
      <h2 className="friends__heading">
        {label} — {entries.length}
      </h2>
      <ul className="friends__list">
        {entries.map((link) => (
          <FriendRow key={link.id} link={link} blocked={tab === 'blocked'} />
        ))}
      </ul>
    </>
  );
}

function PendingLists({
  incoming,
  outgoing,
  query,
}: {
  incoming: FriendLink[];
  outgoing: FriendLink[];
  query: string;
}) {
  if (incoming.length === 0 && outgoing.length === 0) {
    return query !== '' ? (
      <Empty icon="search" title="Aucun resultat" hint={`Rien ne correspond a « ${query} ».`} />
    ) : (
      <Empty
        icon="inbox"
        title="Aucune demande en attente"
        hint="Les demandes recues et celles que vous avez envoyees apparaitront ici."
      />
    );
  }

  return (
    <>
      {incoming.length > 0 ? (
        <>
          <h2 className="friends__heading">Demandes recues — {incoming.length}</h2>
          <ul className="friends__list">
            {incoming.map((link) => (
              <PendingRow key={link.id} link={link} direction="in" />
            ))}
          </ul>
        </>
      ) : null}

      {outgoing.length > 0 ? (
        <>
          <h2 className="friends__heading">Demandes envoyees — {outgoing.length}</h2>
          <ul className="friends__list">
            {outgoing.map((link) => (
              <PendingRow key={link.id} link={link} direction="out" />
            ))}
          </ul>
        </>
      ) : null}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Lignes                                                                      */
/* -------------------------------------------------------------------------- */

const STATUS_LABEL: Record<string, string> = {
  online: 'En ligne',
  idle: 'Absent',
  dnd: 'Ne pas deranger',
  offline: 'Hors ligne',
};

function FriendRow({ link, blocked }: { link: FriendLink; blocked: boolean }) {
  const profile = useFriends((state) => state.profiles[link.user_id]);
  const busy = useFriends((state) => state.busy[link.user_id] === true);
  const remove = useFriends((state) => state.remove);
  const block = useFriends((state) => state.block);
  const unblock = useFriends((state) => state.unblock);

  const openDm = useChat((state) => state.openDm);
  const selectChannel = useUI((state) => state.selectChannel);
  const openModal = useUI((state) => state.openModal);

  if (!profile) return null;

  const message = async () => {
    const channel = await openDm(profile.id);
    if (channel) selectChannel(channel.id);
  };

  return (
    <li className="friends__row">
      <button
        type="button"
        className="friends__identity"
        onClick={() => openModal({ kind: 'profile', userId: profile.id })}
      >
        <Avatar profile={profile} size={32} showStatus />
        <span className="friends__names">
          <span className="friends__name">{profile.display_name}</span>
          <span className="friends__meta">
            {blocked
              ? `@${profile.username}`
              : (profile.custom_status ?? STATUS_LABEL[profile.status] ?? `@${profile.username}`)}
          </span>
        </span>
      </button>

      <div className="friends__actions">
        {blocked ? (
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            disabled={busy}
            onClick={() => void unblock(profile.id)}
          >
            Debloquer
          </button>
        ) : (
          <>
            <RowButton
              icon="thread"
              label="Envoyer un message"
              onClick={() => void message()}
              disabled={busy}
            />
            <RowButton
              icon="user-x"
              label="Retirer de mes amis"
              tone="danger"
              onClick={() => void remove(profile.id)}
              disabled={busy}
            />
            <RowButton
              icon="shield"
              label="Bloquer"
              tone="danger"
              onClick={() => void block(profile.id)}
              disabled={busy}
            />
          </>
        )}
      </div>
    </li>
  );
}

function PendingRow({ link, direction }: { link: FriendLink; direction: 'in' | 'out' }) {
  const profile = useFriends((state) => state.profiles[link.user_id]);
  const busy = useFriends((state) => state.busy[link.user_id] === true);
  const respond = useFriends((state) => state.respond);
  const remove = useFriends((state) => state.remove);
  const openModal = useUI((state) => state.openModal);

  if (!profile) return null;

  return (
    <li className="friends__row">
      <button
        type="button"
        className="friends__identity"
        onClick={() => openModal({ kind: 'profile', userId: profile.id })}
      >
        <Avatar profile={profile} size={32} showStatus />
        <span className="friends__names">
          <span className="friends__name">{profile.display_name}</span>
          <span className="friends__meta">
            {direction === 'in' ? 'Demande recue' : 'Demande envoyee'} · @{profile.username}
          </span>
        </span>
      </button>

      <div className="friends__actions">
        {direction === 'in' ? (
          <>
            <RowButton
              icon="check"
              label="Accepter"
              tone="ok"
              disabled={busy}
              onClick={() => void respond(link.id, true)}
            />
            <RowButton
              icon="x"
              label="Refuser"
              tone="danger"
              disabled={busy}
              onClick={() => void respond(link.id, false)}
            />
          </>
        ) : (
          <RowButton
            icon="x"
            label="Annuler la demande"
            tone="danger"
            disabled={busy}
            onClick={() => void remove(profile.id)}
          />
        )}
      </div>
    </li>
  );
}

function RowButton({
  icon,
  label,
  onClick,
  tone,
  disabled,
}: {
  icon: Parameters<typeof Icon>[0]['name'];
  label: string;
  onClick: () => void;
  tone?: 'ok' | 'danger';
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={'friends__action' + (tone ? ` friends__action--${tone}` : '')}
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
    >
      <Icon name={icon} size={17} />
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Ajout                                                                       */
/* -------------------------------------------------------------------------- */

function AddFriend() {
  const sendRequest = useFriends((state) => state.sendRequest);
  const sending = useFriends((state) => state.sending);
  const notice = useFriends((state) => state.notice);
  const clearNotice = useFriends((state) => state.clearNotice);
  const myUsername = useSession((state) => state.profile?.username);

  const [value, setValue] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const sent = await sendRequest(value);
    if (sent) setValue('');
  };

  return (
    <div className="friends__body friends__body--add">
      <form className="addfriend" onSubmit={(event) => void submit(event)}>
        <h2 className="addfriend__title">Ajouter un ami</h2>
        <p className="addfriend__lede">
          Vous pouvez ajouter quelqu’un avec son pseudo. Attention aux majuscules
          et aux points : le pseudo doit etre exact.
        </p>

        <div
          className={
            'addfriend__box' +
            (notice?.tone === 'error' ? ' is-error' : '') +
            (notice?.tone === 'ok' ? ' is-ok' : '')
          }
        >
          <input
            className="addfriend__field"
            value={value}
            placeholder="Entrez un pseudo"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            aria-label="Pseudo de la personne a ajouter"
            onChange={(event) => {
              setValue(event.target.value);
              if (notice) clearNotice();
            }}
          />
          <button
            type="submit"
            className="btn btn--primary"
            disabled={sending || value.trim().length < 2}
          >
            {sending ? <span className="spinner" /> : null}
            Envoyer la demande
          </button>
        </div>

        {notice ? (
          <p
            className={notice.tone === 'ok' ? 'addfriend__ok' : 'addfriend__error'}
            role={notice.tone === 'ok' ? 'status' : 'alert'}
          >
            {notice.text}
          </p>
        ) : null}

        {myUsername ? <ShareCard username={myUsername} /> : null}
      </form>
    </div>
  );
}

/**
 * Rappel de son propre pseudo.
 *
 * Ajouter quelqu'un suppose qu'il puisse vous ajouter en retour, et peu de gens
 * connaissent leur pseudo par coeur quand il a ete deduit d'une adresse
 * e-mail.
 */
function ShareCard({ username }: { username: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(username);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Presse-papiers refuse : le pseudo reste lisible a l'ecran.
    }
  };

  return (
    <div className="addfriend__share">
      <span className="addfriend__share-label">Votre pseudo</span>
      <code className="addfriend__share-value">@{username}</code>
      <button type="button" className="btn btn--ghost btn--sm" onClick={() => void copy()}>
        <Icon name={copied ? 'check' : 'copy'} size={14} />
        {copied ? 'Copie' : 'Copier'}
      </button>
    </div>
  );
}

function Empty({
  icon,
  title,
  hint,
}: {
  icon: Parameters<typeof Icon>[0]['name'];
  title: string;
  hint: string;
}) {
  return (
    <div className="friends__empty">
      <span className="friends__empty-icon">
        <Icon name={icon} size={26} />
      </span>
      <h2>{title}</h2>
      <p>{hint}</p>
    </div>
  );
}
