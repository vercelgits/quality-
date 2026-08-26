import { useChat } from '@/store/chat';
import { useUI } from '@/store/ui';
import { useSession } from '@/store/session';
import { useVoice } from '@/features/voice/useVoice';
import { Icon } from '@/components/Icon';
import type { Channel } from '@/types/db';

export function ChannelHeader({ channel }: { channel: Channel }) {
  const panel = useUI((state) => state.panel);
  const togglePanel = useUI((state) => state.togglePanel);
  const setPaletteOpen = useUI((state) => state.setPaletteOpen);
  const toggleSidebar = useUI((state) => state.toggleSidebar);

  const threads = useChat((state) => state.threads);
  const profile = useSession((state) => state.profile);

  const voiceChannelId = useVoice((state) => state.channelId);
  const joinVoice = useVoice((state) => state.join);
  const leaveVoice = useVoice((state) => state.leave);
  const connecting = useVoice((state) => state.connecting);

  const openThreadCount = Object.values(threads).filter(
    (thread) => thread.channel_id === channel.id && !thread.resolved,
  ).length;

  const inThisVoice = voiceChannelId === channel.id;

  return (
    <header className="channel-header">
      <button
        type="button"
        className="icon-btn channel-header__toggle"
        onClick={toggleSidebar}
        aria-label="Afficher ou masquer la barre laterale"
      >
        <Icon name="inbox" size={17} />
      </button>

      <span className="channel-header__mark" aria-hidden="true">
        <Icon name={channel.kind === 'voice' ? 'volume' : 'hash'} size={17} />
      </span>

      <h1 className="channel-header__name truncate">{channel.name}</h1>

      {channel.topic ? (
        <>
          <span className="channel-header__separator" aria-hidden="true" />
          <p className="channel-header__topic truncate" title={channel.topic}>
            {channel.topic}
          </p>
        </>
      ) : null}

      <div className="spacer" />

      {channel.kind === 'voice' ? (
        <button
          type="button"
          className={'btn btn--sm' + (inThisVoice ? ' btn--danger' : ' btn--primary')}
          onClick={() => {
            if (inThisVoice) void leaveVoice();
            else if (profile) void joinVoice(channel.id, profile.id);
          }}
          disabled={connecting}
        >
          {connecting ? <span className="spinner" /> : <Icon name={inThisVoice ? 'phone-off' : 'volume'} size={14} />}
          {inThisVoice ? 'Quitter' : 'Rejoindre'}
        </button>
      ) : null}

      <button
        type="button"
        className="icon-btn"
        onClick={() => setPaletteOpen(true)}
        title="Rechercher (Ctrl+K)"
        aria-label="Rechercher"
      >
        <Icon name="search" size={17} />
      </button>

      <button
        type="button"
        className={'icon-btn' + (panel === 'thread' ? ' is-active' : '')}
        onClick={() => togglePanel('thread')}
        title="Fils de discussion"
        aria-label="Fils de discussion"
      >
        <Icon name="thread" size={17} />
        {openThreadCount > 0 ? (
          <span className="icon-btn__dot" aria-label={`${openThreadCount} fils ouverts`} />
        ) : null}
      </button>

      <button
        type="button"
        className={'icon-btn' + (panel === 'pins' ? ' is-active' : '')}
        onClick={() => togglePanel('pins')}
        title="Messages epingles"
        aria-label="Messages epingles"
      >
        <Icon name="pin" size={17} />
      </button>

      <button
        type="button"
        className={'icon-btn' + (panel === 'members' ? ' is-active' : '')}
        onClick={() => togglePanel('members')}
        title="Membres"
        aria-label="Membres"
      >
        <Icon name="users" size={17} />
      </button>
    </header>
  );
}
