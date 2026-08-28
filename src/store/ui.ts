import { create } from 'zustand';
import type { UUID } from '@/types/db';

/** Panneau lateral droit. Un seul est visible a la fois. */
export type SidePanel = 'none' | 'thread' | 'pins' | 'members' | 'search';

export type Modal =
  | { kind: 'none' }
  | { kind: 'create-space' }
  | { kind: 'join-space' }
  | { kind: 'create-channel'; spaceId: UUID }
  | { kind: 'channel-settings'; channelId: UUID }
  | { kind: 'invite'; spaceId: UUID }
  | { kind: 'profile'; userId: UUID }
  | { kind: 'moderation'; spaceId: UUID }
  | { kind: 'report'; messageId: UUID }
  | { kind: 'poll'; channelId: UUID; threadId: UUID | null }
  | { kind: 'bookmarks' }
  | { kind: 'edit-profile' }
  | { kind: 'new-dm' }
  | { kind: 'space-settings'; spaceId: UUID };

/**
 * Ce que montre la barre laterale.
 *
 * `direct` est un etat a part entiere et non l'absence d'espace : sans cela,
 * la selection automatique du premier espace ecraserait immediatement le choix
 * de l'utilisateur.
 */
export type SidebarView = 'space' | 'direct';

/**
 * Sections des parametres, en pleine page.
 *
 * Une page et non une fenetre : il y a trop de reglages pour une boite de
 * dialogue, et un test de micro ou un apercu de camera y seraient a l'etroit.
 */
export type SettingsSection =
  | 'compte'
  | 'profil'
  | 'confidentialite'
  | 'voix'
  | 'discussion'
  | 'apparence'
  | 'accessibilite'
  | 'notifications'
  | 'raccourcis'
  | 'avance';

interface UIState {
  view: SidebarView;
  /**
   * Page des amis affichee a la place d'une conversation privee.
   * N'a de sens que dans la vue privee.
   */
  friendsOpen: boolean;
  /** Parametres en pleine page ; `null` quand ils sont fermes. */
  settings: SettingsSection | null;
  activeSpaceId: UUID | null;
  activeChannelId: UUID | null;
  activeThreadId: UUID | null;

  panel: SidePanel;
  modal: Modal;
  paletteOpen: boolean;

  /** Message en cours de citation dans le compositeur. */
  replyingTo: UUID | null;
  /** Message en cours de modification. */
  editingId: UUID | null;

  /** Barre laterale repliee, pour le mode concentre sur grand ecran. */
  sidebarCollapsed: boolean;
  /**
   * Tiroir de navigation ouvert. N'a de sens que sur petit ecran, ou la
   * navigation recouvre la conversation au lieu de la cotoyer.
   */
  navOpen: boolean;

  searchQuery: string;

  showFriends: () => void;
  openSettings: (section?: SettingsSection) => void;
  closeSettings: () => void;

  selectSpace: (spaceId: UUID | null) => void;
  showDirectMessages: () => void;
  selectChannel: (channelId: UUID) => void;
  openThread: (threadId: UUID) => void;
  closeThread: () => void;
  setPanel: (panel: SidePanel) => void;
  togglePanel: (panel: SidePanel) => void;
  openModal: (modal: Modal) => void;
  closeModal: () => void;
  setPaletteOpen: (open: boolean) => void;
  setReplyingTo: (messageId: UUID | null) => void;
  setEditingId: (messageId: UUID | null) => void;
  toggleSidebar: () => void;
  openNav: () => void;
  closeNav: () => void;
  setSearchQuery: (query: string) => void;
}

export const useUI = create<UIState>((set, get) => ({
  view: 'space',
  friendsOpen: false,
  settings: null,
  activeSpaceId: null,
  activeChannelId: null,
  activeThreadId: null,

  panel: 'none',
  modal: { kind: 'none' },
  paletteOpen: false,

  replyingTo: null,
  editingId: null,
  sidebarCollapsed: false,
  navOpen: false,
  searchQuery: '',

  showFriends: () =>
    set({
      view: 'direct',
      friendsOpen: true,
      activeSpaceId: null,
      activeChannelId: null,
      activeThreadId: null,
      panel: 'none',
      navOpen: false,
    }),

  openSettings: (section = 'compte') => set({ settings: section, navOpen: false }),
  closeSettings: () => set({ settings: null }),

  selectSpace: (spaceId) =>
    set({
      view: 'space',
      friendsOpen: false,
      activeSpaceId: spaceId,
      activeChannelId: null,
      activeThreadId: null,
      panel: 'none',
      replyingTo: null,
      editingId: null,
    }),

  selectChannel: (channelId) =>
    set({
      activeChannelId: channelId,
      // Ouvrir une conversation quitte la page des amis : les deux occupent la
      // meme zone.
      friendsOpen: false,
      // Choisir un salon referme le tiroir : sur mobile il masque la
      // conversation qu'on vient justement de demander.
      navOpen: false,
      // Changer de salon ferme le fil : son contenu n'a plus de rapport avec
      // ce qui est affiche a gauche.
      activeThreadId: null,
      panel: get().panel === 'thread' ? 'none' : get().panel,
      replyingTo: null,
      editingId: null,
    }),

  showDirectMessages: () =>
    set({
      view: 'direct',
      // Le bouton d'accueil des messages prives ouvre les amis : c'est de la
      // qu'on demarre une conversation, et la liste de gauche peut etre vide.
      friendsOpen: true,
      activeSpaceId: null,
      activeChannelId: null,
      activeThreadId: null,
      panel: 'none',
      replyingTo: null,
      editingId: null,
    }),

  openThread: (threadId) => set({ activeThreadId: threadId, panel: 'thread' }),

  closeThread: () => set({ activeThreadId: null, panel: 'none' }),

  setPanel: (panel) => set({ panel, navOpen: false }),

  togglePanel: (panel) =>
    set((state) => ({
      panel: state.panel === panel ? 'none' : panel,
      activeThreadId: panel === 'thread' ? state.activeThreadId : null,
    })),

  openModal: (modal) => set({ modal }),
  closeModal: () => set({ modal: { kind: 'none' } }),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  setReplyingTo: (replyingTo) => set({ replyingTo, editingId: null }),
  setEditingId: (editingId) => set({ editingId, replyingTo: null }),
  toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  openNav: () => set({ navOpen: true }),
  closeNav: () => set({ navOpen: false }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
}));
