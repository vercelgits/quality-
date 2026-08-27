import { useChat } from '@/store/chat';
import { useUI } from '@/store/ui';
import { useSession } from '@/store/session';
import { useVoice } from '@/features/voice/useVoice';
import { Icon } from '@/components/Icon';
import { Avatar } from '@/components/Avatar';
import { dmTitle } from '@/features/dm/DirectMessageList';
import { useIsMobile } from '@/lib/useMediaQuery';
import type { Channel } from '@/types/db';

export function ChannelHeader({ channel }: { channel: Channel }) {
  const panel = useUI((state) => state.panel);
  const togglePanel = useUI((state) => state.togglePanel);
  const setPaletteOpen = useUI((state) => state.setPaletteOpen);
  const toggleSidebar = useUI((state) => state.toggleSidebar);
  const openNav = useUI((state) => state.openNav);
  const isMobile = useIsMobile();

  const threads = useChat((state) => state.threads);
  const dmParticipants = useChat((state) => state.dmParticipants);
  const profiles = useChat((state) => state.profiles);
  const profile = useSession((state) => state.profile);

  const voiceChannelId = useVoice((state) => state.channelId);
  const joinVoice = useVoice((state) => state.join);
  const connecting = useVoice((state) => state.connecting);

  const openThreadCount = Object.values(threads).filter(
    (thread) => thread.channel_id === channel.id && !thread.resolved,
  ).length;

  const inThisVoice = voiceChannelId === channel.id;

  // Une conversation privee n'a ni sujet, ni moderation, ni salon vocal.
  const isDirect = channel.space_id === null;
  const participants = dmParticipants[channel.id] ?? [];
  const title = isDirect ? dmTitle(channel, participants, profiles, profile?.id) : channel.name;
  const otherProfile = isDirect
    ? profiles[participants.find((id) => id !== profile?.id) ?? '']
    : undefined;

  return (
    <header className="channel-header">
      <button
        type="button"
        className="icon-btn channel-header__toggle"
        onClick={isMobile ? openNav : toggleSidebar}
        aria-label={isMobile ? 'Ouvrir la navigation' : 'Afficher ou masquer la barre laterale'}
      >
        <Icon name={isMobile ? 'chevron-right' : 'inbox'} size={18} />
      </button>

      {isDirect ? (
        <>
          <Avatar profile={otherProfile} size={28} status={otherProfile?.status} showStatus />
          <h1 className="channel-header__name truncate">{title}</h1>
        </>
      ) : (
        <>
          <span className="channel-header__mark" aria-hidden="true">
            <Icon name={channel.kind === 'voice' ? 'volume' : 'hash'} size={17} />
          </span>
          <h1 className="channel-header__name truncate">{channel.name}</h1>
        </>
      )}

      {channel.topic && !isDirect ? (
        <>
          <span className="channel-header__separator" aria-hidden="true" />
          <p className="channel-header__topic truncate" title={channel.topic}>
            {channel.topic}
          </p>
        </>
      ) : null}

      <div className="spacer" />

      {/*
        Une fois en ligne, la barre de commandes de la scene porte deja
        « Quitter » : le repeter dans l'en-tete donnait deux boutons rouges a
        l'ecran pour une seule action.
      */}
      {channel.kind === 'voice' && !inThisVoice ? (
        <button
          type="button"
          className="btn btn--sm btn--primary"
          onClick={() => profile && void joinVoice(channel.id, profile.id)}
          disabled={connecting || !profile}
        >
          {connecting ? <span className="spinner" /> : <Icon name="volume" size={14} />}
          Rejoindre
        </button>
      ) : null}

      <button
        type="button"
        className="icon-btn channel-header__action"
        onClick={() => setPaletteOpen(true)}
        title="Rechercher — Ctrl+K"
      >
        <Icon name="search" size={17} />
        <span className="visually-hidden">Rechercher</span>
      </button>

      <button
        type="button"
        className={
          'icon-btn channel-header__action' +
          (panel === 'thread' ? ' is-active' : '')
        }
        onClick={() => togglePanel('thread')}
        title="Fils de discussion — les questions en attente de reponse"
        aria-pressed={panel === 'thread'}
      >
        <Icon name="thread" size={17} />
        <span className="visually-hidden">Fils</span>
        {openThreadCount > 0 ? (
          <span className="icon-btn__dot" aria-label={`${openThreadCount} fils ouverts`} />
        ) : null}
      </button>

      <button
        type="button"
        className={
          'icon-btn channel-header__action' +
          (panel === 'pins' ? ' is-active' : '')
        }
        onClick={() => togglePanel('pins')}
        title="Messages epingles — ce qu'il faut garder sous la main"
        aria-pressed={panel === 'pins'}
      >
        <Icon name="pin" size={17} />
        <span className="visually-hidden">Epingles</span>
      </button>

      <button
        type="button"
        className={
          'icon-btn channel-header__action' +
          (panel === 'members' ? ' is-active' : '')
        }
        onClick={() => togglePanel('members')}
        title="Qui est dans cet espace"
        aria-pressed={panel === 'members'}
      >
        <Icon name="users" size={17} />
        <span className="visually-hidden">Membres</span>
      </button>
    </header>
  );
}
