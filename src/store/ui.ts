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
  | { kind: 'bookmarks' };

interface UIState {
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

  /** Barre laterale repliee, pour les petits ecrans et le mode concentre. */
  sidebarCollapsed: boolean;

  searchQuery: string;

  selectSpace: (spaceId: UUID | null) => void;
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
  setSearchQuery: (query: string) => void;
}

export const useUI = create<UIState>((set, get) => ({
  activeSpaceId: null,
  activeChannelId: null,
  activeThreadId: null,

  panel: 'none',
  modal: { kind: 'none' },
  paletteOpen: false,

  replyingTo: null,
  editingId: null,
  sidebarCollapsed: false,
  searchQuery: '',

  selectSpace: (spaceId) =>
    set({
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
      // Changer de salon ferme le fil : son contenu n'a plus de rapport avec
      // ce qui est affiche a gauche.
      activeThreadId: null,
      panel: get().panel === 'thread' ? 'none' : get().panel,
      replyingTo: null,
      editingId: null,
    }),

  openThread: (threadId) => set({ activeThreadId: threadId, panel: 'thread' }),

  closeThread: () => set({ activeThreadId: null, panel: 'none' }),

  setPanel: (panel) => set({ panel }),

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
  setSearchQuery: (searchQuery) => set({ searchQuery }),
}));
