import { useEffect, useMemo, useState } from 'react';
import { Modal } from '@/components/Modal';
import { Icon } from '@/components/Icon';
import { Avatar } from '@/components/Avatar';
import { useChat } from '@/store/chat';
import { useUI } from '@/store/ui';
import { useSession } from '@/store/session';
import type { UUID } from '@/types/db';

/**
 * Nouvelle conversation privee.
 *
 * On ne peut ecrire qu'aux personnes avec qui on partage un espace : la liste
 * est donc construite a partir des membres connus, et la base applique la meme
 * regle de son cote.
 */
export function NewDmModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const profiles = useChat((state) => state.profiles);
  const members = useChat((state) => state.members);
  const openDm = useChat((state) => state.openDm);
  const createGroupDm = useChat((state) => state.createGroupDm);

  const myId = useSession((state) => state.profile?.id);
  const selectChannel = useUI((state) => state.selectChannel);
  const showDirectMessages = useUI((state) => state.showDirectMessages);

  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState<UUID[]>([]);
  const [groupName, setGroupName] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setQuery('');
      setChosen([]);
      setGroupName('');
    }
  }, [open]);

  // Seules les personnes rencontrees dans un espace commun sont proposees.
  const candidates = useMemo(() => {
    const reachable = new Set(members.map((member) => member.user_id));
    const needle = query.trim().toLowerCase();

    return Object.values(profiles)
      .filter((profile) => profile.id !== myId && reachable.has(profile.id))
      .filter(
        (profile) =>
          needle.length === 0 ||
          profile.display_name.toLowerCase().includes(needle) ||
          profile.username.toLowerCase().includes(needle),
      )
      .sort((a, b) => a.display_name.localeCompare(b.display_name, 'fr'));
  }, [profiles, members, myId, query]);

  const toggle = (id: UUID) => {
    setChosen((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  };

  const start = async () => {
    if (chosen.length === 0 || busy) return;
    setBusy(true);

    const channel =
      chosen.length === 1
        ? await openDm(chosen[0]!)
        : await createGroupDm(chosen, groupName.trim() || undefined);

    setBusy(false);

    if (channel) {
      showDirectMessages();
      selectChannel(channel.id);
      onClose();
    }
  };

  return (
    <Modal
      open={open}
      title="Nouvelle conversation"
      description="Choisissez une personne, ou plusieurs pour creer un groupe."
      onClose={onClose}
      width={480}
      footer={
        <>
          <span className="modal__count">
            {chosen.length === 0
              ? 'Personne selectionnee'
              : chosen.length === 1
                ? '1 personne'
                : `${chosen.length} personnes`}
          </span>
          <div className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Annuler
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={chosen.length === 0 || busy}
            onClick={() => void start()}
          >
            {busy ? <span className="spinner" /> : <Icon name="send" size={15} />}
            {chosen.length > 1 ? 'Creer le groupe' : 'Ouvrir'}
          </button>
        </>
      }
    >
      <div className="field">
        <label className="field__label" htmlFor="dm-search">
          Rechercher une personne
        </label>
        <input
          id="dm-search"
          className="input"
          value={query}
          placeholder="Nom ou pseudo"
          onChange={(event) => setQuery(event.target.value)}
          autoComplete="off"
        />
      </div>

      {chosen.length > 1 ? (
        <div className="field">
          <label className="field__label" htmlFor="dm-group-name">
            Nom du groupe
          </label>
          <input
            id="dm-group-name"
            className="input"
            value={groupName}
            maxLength={48}
            placeholder="Facultatif"
            onChange={(event) => setGroupName(event.target.value)}
          />
        </div>
      ) : null}

      {candidates.length === 0 ? (
        <div className="empty">
          <span className="empty__icon">
            <Icon name="users" size={24} />
          </span>
          <p className="empty__title">Personne a qui ecrire</p>
          <p className="empty__body">
            {query
              ? 'Aucun nom ne correspond.'
              : 'Rejoignez un espace pour rencontrer du monde : on ne peut ecrire qu’aux personnes avec qui on partage un espace.'}
          </p>
        </div>
      ) : (
        <ul className="dm-picker" role="listbox" aria-multiselectable="true">
          {candidates.map((profile) => {
            const selected = chosen.includes(profile.id);
            return (
              <li key={profile.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className={'dm-picker__item' + (selected ? ' is-selected' : '')}
                  onClick={() => toggle(profile.id)}
                >
                  <Avatar profile={profile} size={34} status={profile.status} showStatus />
                  <span className="dm-picker__body">
                    <span className="dm-picker__name truncate">{profile.display_name}</span>
                    <span className="dm-picker__handle truncate">@{profile.username}</span>
                  </span>
                  <span className="dm-picker__check" aria-hidden="true">
                    {selected ? <Icon name="check" size={14} /> : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
}
