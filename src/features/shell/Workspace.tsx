import { useEffect } from 'react';
import { useChat } from '@/store/chat';
import { useUI } from '@/store/ui';
import { useSession } from '@/store/session';
import { startRealtime } from '@/lib/realtime';
import { supabase } from '@/lib/supabase';
import { SpaceRail } from './SpaceRail';
import { Sidebar } from './Sidebar';
import { SidePanel } from './SidePanel';
import { ChannelHeader } from '@/features/channels/ChannelHeader';
import { MessageList } from '@/features/messages/MessageList';
import { Composer } from '@/features/messages/Composer';
import { VoiceStage } from '@/features/voice/VoiceStage';
import { CommandPalette } from '@/features/palette/CommandPalette';
import { Modals } from '@/features/settings/Modals';
import { Icon } from '@/components/Icon';
import { useIsMobile } from '@/lib/useMediaQuery';
import type { Profile } from '@/types/db';

export function Workspace() {
  const session = useSession((state) => state.session);
  const profile = useSession((state) => state.profile);
  const setProfile = useSession((state) => state.setProfile);
  const setStatus = useSession((state) => state.setStatus);

  const ready = useChat((state) => state.ready);
  const error = useChat((state) => state.error);
  const spaces = useChat((state) => state.spaces);
  const channels = useChat((state) => state.channels);
  const bootstrapChat = useChat((state) => state.bootstrap);
  const resetChat = useChat((state) => state.reset);

  const view = useUI((state) => state.view);
  const activeSpaceId = useUI((state) => state.activeSpaceId);
  const activeChannelId = useUI((state) => state.activeChannelId);
  const sidebarCollapsed = useUI((state) => state.sidebarCollapsed);
  const navOpen = useUI((state) => state.navOpen);
  const closeNav = useUI((state) => state.closeNav);
  const isMobile = useIsMobile();
  const selectSpace = useUI((state) => state.selectSpace);
  const selectChannel = useUI((state) => state.selectChannel);
  const setPaletteOpen = useUI((state) => state.setPaletteOpen);
  const paletteOpen = useUI((state) => state.paletteOpen);
  const togglePanel = useUI((state) => state.togglePanel);

  const userId = session?.user.id;

  /* --------------------------------------------------------------- Amorcage */

  useEffect(() => {
    if (!userId) return;

    let cancelled = false;

    void (async () => {
      await bootstrapChat();
      if (cancelled) return;

      // Le profil vient de la meme charge utile : inutile de le redemander.
      const loaded = useChat.getState().profiles[userId];
      if (loaded) {
        setProfile(loaded);
      } else {
        const { data } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
        if (data && !cancelled) setProfile(data as Profile);
      }
    })();

    const stop = startRealtime(userId);

    return () => {
      cancelled = true;
      stop();
      resetChat();
    };
  }, [userId, bootstrapChat, resetChat, setProfile]);

  /* ------------------------------------------------- Selection par defaut */

  useEffect(() => {
    // En vue privee, l'absence d'espace actif est voulue : la remplir
    // renverrait l'utilisateur dans un espace a chaque rendu.
    if (view === 'direct') return;
    if (!ready || spaces.length === 0) return;
    if (activeSpaceId && spaces.some((space) => space.id === activeSpaceId)) return;
    selectSpace(spaces[0]!.id);
  }, [ready, spaces, activeSpaceId, selectSpace, view]);

  useEffect(() => {
    if (!activeSpaceId) return;
    const inSpace = channels.filter((channel) => channel.space_id === activeSpaceId);
    if (activeChannelId && inSpace.some((channel) => channel.id === activeChannelId)) return;

    const firstText = inSpace.find((channel) => channel.kind === 'text') ?? inSpace[0];
    if (firstText) selectChannel(firstText.id);
  }, [activeSpaceId, activeChannelId, channels, selectChannel]);

  /* ------------------------------------------------------- Presence en ligne */

  useEffect(() => {
    if (!profile) return;

    // Passe en absent quand l'onglet reste cache, et revient en ligne au retour.
    const handleVisibility = () => {
      void setStatus(document.hidden ? 'idle' : 'online');
    };

    // Le navigateur ne garantit pas l'execution d'une requete pendant la
    // fermeture : on tente le passage hors ligne sans compter dessus, la
    // presence Realtime prenant le relais en cas d'echec.
    const handleUnload = () => {
      void setStatus('offline');
    };

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('pagehide', handleUnload);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('pagehide', handleUnload);
    };
  }, [profile, setStatus]);

  /* ------------------------------------------------------ Raccourcis clavier */

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const modifier = event.ctrlKey || event.metaKey;

      if (event.key === 'Escape' && useUI.getState().navOpen) {
        event.preventDefault();
        useUI.getState().closeNav();
        return;
      }

      if (modifier && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen(!paletteOpen);
        return;
      }

      if (modifier && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        togglePanel('search');
        return;
      }

      // Les raccourcis sans modificateur ne doivent pas se declencher pendant
      // la frappe d'un message.
      const target = event.target as HTMLElement | null;
      const typing =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable === true;

      if (typing) return;

      if (modifier && event.key === ',') {
        event.preventDefault();
        useUI.getState().openModal({ kind: 'preferences' });
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [paletteOpen, setPaletteOpen, togglePanel]);

  /* ---------------------------------------------------------------- Rendu */

  const channel = channels.find((item) => item.id === activeChannelId) ?? null;

  if (!ready) {
    return (
      <div className="boot">
        <span className="boot__mark">
          <Icon name="compass" size={26} />
        </span>
        <span className="spinner" />
        <p>Chargement de vos espaces…</p>
      </div>
    );
  }

  return (
    <div
      className={
        'workspace' +
        (sidebarCollapsed ? ' is-collapsed' : '') +
        (isMobile ? ' is-mobile' : '') +
        (navOpen ? ' is-nav-open' : '')
      }
    >
      {/* Sur petit ecran, la navigation recouvre la conversation : il faut un
          voile pour la refermer, et l'ecarter des lecteurs d'ecran quand elle
          est fermee. */}
      {isMobile && navOpen ? (
        <button
          type="button"
          className="nav-scrim"
          onClick={closeNav}
          aria-label="Fermer la navigation"
        />
      ) : null}

      <div
        className="workspace__nav"
        inert={isMobile && !navOpen ? true : undefined}
      >
        <SpaceRail />
        <Sidebar />
      </div>

      <main className="main" id="conversation">
        {channel ? (
          <>
            <ChannelHeader channel={channel} />

            {channel.kind === 'voice' ? (
              <VoiceStage channel={channel} />
            ) : (
              <>
                <MessageList channelId={channel.id} />
                <Composer channelId={channel.id} autoFocus />
              </>
            )}
          </>
        ) : (
          <div className="main__empty">
            <span className="empty__icon">
              <Icon name={view === 'direct' ? 'thread' : 'hash'} size={26} />
            </span>

            {view === 'direct' ? (
              <>
                <h2>Aucune conversation ouverte</h2>
                <p>
                  Choisissez une conversation a gauche, ou demarrez-en une nouvelle.
                  Vous pouvez ecrire aux personnes avec qui vous partagez un espace.
                </p>
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={() => useUI.getState().openModal({ kind: 'new-dm' })}
                >
                  <Icon name="plus" size={15} />
                  Nouvelle conversation
                </button>
              </>
            ) : (
              <>
                <h2>Aucun salon selectionne</h2>
                <p>
                  Choisissez un salon a gauche, ou appuyez sur{' '}
                  <span className="kbd">Ctrl</span>
                  <span className="kbd">K</span> pour tout atteindre au clavier.
                </p>
              </>
            )}
          </div>
        )}
      </main>

      <SidePanel />
      <CommandPalette />
      <Modals />

      {error ? (
        <div className="toast" role="alert">
          <Icon name="x" size={14} />
          <span>{error}</span>
          <button
            type="button"
            className="icon-btn"
            onClick={() => useChat.setState({ error: null })}
            aria-label="Fermer"
          >
            <Icon name="x" size={13} />
          </button>
        </div>
      ) : null}
    </div>
  );
}
