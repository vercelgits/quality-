import { useState } from 'react';
import { useChat } from '@/store/chat';
import { useSession } from '@/store/session';
import { useContextMenu } from '@/components/ContextMenu';
import { SpaceContextMenu } from '@/features/spaces/SpaceContextMenu';
import { Modal } from '@/components/Modal';
import type { UUID } from '@/types/db';
import { useUI } from '@/store/ui';
import { initialsFor } from '@/constants';
import { Icon } from '@/components/Icon';

/**
 * Colonne d'icones des espaces.
 *
 * L'indicateur a gauche de chaque icone dit trois choses d'un coup d'oeil :
 * espace actif (barre haute), messages non lus (point), mentions (pastille
 * chiffree). C'est l'information la plus consultee de toute l'interface, donc
 * elle ne demande jamais de survol pour apparaitre.
 */
export function SpaceRail() {
  const spaces = useChat((state) => state.spaces);
  const channels = useChat((state) => state.channels);
  const readStates = useChat((state) => state.readStates);

  const activeSpaceId = useUI((state) => state.activeSpaceId);
  const selectSpace = useUI((state) => state.selectSpace);
  const openModal = useUI((state) => state.openModal);
  const view = useUI((state) => state.view);
  const showDirectMessages = useUI((state) => state.showDirectMessages);
  const members = useChat((state) => state.members);
  const leaveSpace = useChat((state) => state.leaveSpace);
  const moi = useSession((state) => state.profile);

  const menu = useContextMenu();
  // Le menu est unique et se deplace : en monter un par pastille en
  // fabriquerait autant que d'espaces, tous inutiles sauf un.
  const [cible, setCible] = useState<UUID | null>(null);
  const [aQuitter, setAQuitter] = useState<UUID | null>(null);

  const espaceVise = spaces.find((space) => space.id === cible);
  const espaceAQuitter = spaces.find((space) => space.id === aQuitter);

  const rangDans = (spaceId: UUID) =>
    members.find((membre) => membre.space_id === spaceId && membre.user_id === moi?.id)?.role;

  // Non-lus cumules de toutes les conversations privees, affiches sur le
  // bouton d'accueil.
  const directUnread = channels
    .filter((channel) => channel.space_id === null)
    .reduce((total, channel) => total + (readStates[channel.id]?.mention_count ?? 0), 0);

  return (
    <nav className="rail" aria-label="Navigation principale">
      {menu.position && espaceVise ? (
        <SpaceContextMenu
          space={espaceVise}
          role={rangDans(espaceVise.id)}
          position={menu.position}
          onClose={menu.close}
          onLeave={() => setAQuitter(espaceVise.id)}
        />
      ) : null}

      <Modal
        open={espaceAQuitter !== undefined}
        title={`Quitter ${espaceAQuitter?.name ?? ''} ?`}
        description="Vous perdrez l'acces a ses salons. Il faudra une nouvelle invitation pour revenir."
        onClose={() => setAQuitter(null)}
        width={440}
        footer={
          <>
            <button type="button" className="btn" onClick={() => setAQuitter(null)}>
              Annuler
            </button>
            <button
              type="button"
              className="btn btn--danger"
              onClick={() => {
                const id = aQuitter;
                setAQuitter(null);
                if (id && moi) void leaveSpace(id, moi.id);
              }}
            >
              <Icon name="log-out" size={15} />
              Quitter
            </button>
          </>
        }
      >
        <p className="field__hint">
          Vos messages restent en place : partir ne les efface pas.
        </p>
      </Modal>

      <div className="rail__home">
        <span
          className={'rail__indicator' + (view === 'direct' ? ' is-active' : '')}
          aria-hidden="true"
        />
        <button
          type="button"
          className={'rail__button rail__button--home' + (view === 'direct' ? ' is-active' : '')}
          onClick={showDirectMessages}
          aria-current={view === 'direct' ? 'true' : undefined}
          title="Messages prives"
        >
          <Icon name="thread" size={21} />
          <span className="visually-hidden">Messages prives</span>
        </button>

        {directUnread > 0 ? (
          <span className="rail__badge badge" aria-label={`${directUnread} mentions privees`}>
            {directUnread > 99 ? '99+' : directUnread}
          </span>
        ) : null}
      </div>

      <hr className="rail__divider" />

      <ul className="rail__list">
        {spaces.map((space) => {
          const spaceChannels = channels.filter(
            (channel) => channel.space_id === space.id && channel.kind === 'text',
          );

          let unread = 0;
          let mentions = 0;
          for (const channel of spaceChannels) {
            const state = readStates[channel.id];
            if (!state) continue;
            unread += state.unread_count;
            mentions += state.mention_count;
          }

          const isActive = space.id === activeSpaceId;

          return (
            <li key={space.id} className="rail__item">
              <span
                className={
                  'rail__indicator' +
                  (isActive && view === 'space'
                    ? ' is-active'
                    : unread > 0
                      ? ' is-unread'
                      : '')
                }
                aria-hidden="true"
              />

              <button
                type="button"
                className={
                  'rail__button' + (isActive && view === 'space' ? ' is-active' : '')
                }
                onClick={() => selectSpace(space.id)}
                onContextMenu={(event) => {
                  setCible(space.id);
                  menu.open(event);
                }}
                aria-current={isActive ? 'true' : undefined}
                title={space.name}
              >
                {space.icon_url ? (
                  <img src={space.icon_url} alt="" className="rail__icon-image" />
                ) : (
                  <span className="rail__initials">{initialsFor(space.name)}</span>
                )}
                <span className="visually-hidden">{space.name}</span>
              </button>

              {mentions > 0 ? (
                <span className="rail__badge badge" aria-label={`${mentions} mentions`}>
                  {mentions > 99 ? '99+' : mentions}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>

      <div className="rail__actions">
        <button
          type="button"
          className="rail__button rail__button--ghost"
          onClick={() => openModal({ kind: 'create-space' })}
          title="Creer un espace"
        >
          <Icon name="plus" size={20} />
          <span className="visually-hidden">Creer un espace</span>
        </button>

        <button
          type="button"
          className="rail__button rail__button--ghost"
          onClick={() => openModal({ kind: 'join-space' })}
          title="Rejoindre avec un code"
        >
          <Icon name="compass" size={20} />
          <span className="visually-hidden">Rejoindre un espace</span>
        </button>
      </div>
    </nav>
  );
}
