import { useChat } from '@/store/chat';
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

  return (
    <nav className="rail" aria-label="Espaces">
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
                  (isActive ? ' is-active' : unread > 0 ? ' is-unread' : '')
                }
                aria-hidden="true"
              />

              <button
                type="button"
                className={'rail__button' + (isActive ? ' is-active' : '')}
                style={{ '--space-accent': space.accent } as React.CSSProperties}
                onClick={() => selectSpace(space.id)}
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
