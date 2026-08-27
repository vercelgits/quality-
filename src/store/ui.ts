import { create } from 'zustand';
import type { UUID } from '@/types/db';

/** Panneau lateral droit. Un seul est visible a la fois. */
export type SidePanel = 'none' | 'thread' | 'pins' | 'members' | 'search';

export type Modal =
  | { kind: 'none' }
  | { kind: 'preferences' }
  | { kind: 'create-space' }
  | { kind: 'join-space' }
  | { kind: 'create-channel'; spaceId: UUID }
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

interface UIState {
  view: SidebarView;
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

  selectSpace: (spaceId) =>
    set({
      view: 'space',
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
