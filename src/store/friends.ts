import { create } from 'zustand';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase, errorMessage } from '@/lib/supabase';
import type { FriendLink, FriendsOverview, Profile, UUID } from '@/types/db';

/**
 * Amis, demandes en cours et personnes bloquees.
 *
 * Un magasin distinct de la conversation : la liste d'amis survit au changement
 * d'espace et n'a aucun rapport avec le salon ouvert. La melanger a `chat`
 * obligerait a la recharger a chaque navigation.
 */

interface FriendsState {
  friends: FriendLink[];
  incoming: FriendLink[];
  outgoing: FriendLink[];
  blocked: FriendLink[];
  /** Profils des personnes citees ci-dessus, indexes par identifiant. */
  profiles: Record<UUID, Profile>;

  loading: boolean;
  /** Erreur de chargement, distincte de celle d'une action. */
  error: string | null;
  /** Retour de la derniere demande envoyee. */
  notice: { tone: 'ok' | 'error'; text: string } | null;
  sending: boolean;
  /** Relations en cours de traitement, pour desactiver le bon bouton. */
  busy: Record<UUID, boolean>;

  load: () => Promise<void>;
  subscribe: (userId: UUID) => () => void;

  sendRequest: (username: string) => Promise<boolean>;
  respond: (id: UUID, accept: boolean) => Promise<void>;
  remove: (userId: UUID) => Promise<void>;
  block: (userId: UUID) => Promise<void>;
  unblock: (userId: UUID) => Promise<void>;
  clearNotice: () => void;
  reset: () => void;
}

/** Abonnement en cours, hors de l'etat React : il n'entre dans aucun rendu. */
let liveChannel: RealtimeChannel | null = null;
let subscriptionCount = 0;

const EMPTY = {
  friends: [] as FriendLink[],
  incoming: [] as FriendLink[],
  outgoing: [] as FriendLink[],
  blocked: [] as FriendLink[],
  profiles: {} as Record<UUID, Profile>,
};

export const useFriends = create<FriendsState>((set, get) => ({
  ...EMPTY,
  loading: false,
  error: null,
  notice: null,
  sending: false,
  busy: {},

  load: async () => {
    set({ loading: true, error: null });

    const { data, error } = await supabase.rpc('friends_overview');

    if (error) {
      set({ loading: false, error: errorMessage(error) });
      return;
    }

    const payload = data as FriendsOverview;
    set({
      friends: payload.friends ?? [],
      incoming: payload.incoming ?? [],
      outgoing: payload.outgoing ?? [],
      blocked: payload.blocked ?? [],
      profiles: Object.fromEntries((payload.profiles ?? []).map((p) => [p.id, p])),
      loading: false,
    });
  },

  /**
   * Suit les changements en direct.
   *
   * Le rechargement complet plutot qu'une mise a jour ciblee : une ligne de
   * relation ne porte pas le profil de l'autre personne, qu'il faudrait aller
   * chercher separement. A l'echelle d'une liste d'amis, une requete de plus
   * coute moins cher que la synchronisation partielle a maintenir.
   */
  subscribe: (userId) => {
    // Un abonnement precedent peut ne pas etre entierement retire : sa
    // suppression est asynchrone, alors que React peut remonter le composant
    // dans la foulee. On le libere donc explicitement, et le sujet porte un
    // numero d'ordre pour qu'une suppression encore en vol ne puisse pas nous
    // rendre l'ancien canal — deja abonne, il refuserait les gestionnaires et
    // l'exception viderait toute l'application.
    if (liveChannel) {
      void supabase.removeChannel(liveChannel);
      liveChannel = null;
    }

    subscriptionCount += 1;

    const channel = supabase
      .channel(`orbit:friends:${userId}:${subscriptionCount}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'friendships' },
        () => void get().load(),
      )
      .subscribe();

    liveChannel = channel;

    return () => {
      if (liveChannel === channel) liveChannel = null;
      void supabase.removeChannel(channel);
    };
  },

  sendRequest: async (username) => {
    const wanted = username.trim().replace(/^@/, '').toLowerCase();

    if (wanted.length < 2) {
      set({ notice: { tone: 'error', text: 'Entrez un pseudo.' } });
      return false;
    }

    set({ sending: true, notice: null });

    const { error } = await supabase.rpc('send_friend_request', { p_username: wanted });

    set({ sending: false });

    if (error) {
      set({ notice: { tone: 'error', text: errorMessage(error) } });
      return false;
    }

    set({ notice: { tone: 'ok', text: `Demande envoyee a @${wanted}.` } });
    await get().load();
    return true;
  },

  respond: async (id, accept) => {
    const link =
      get().incoming.find((entry) => entry.id === id) ??
      get().outgoing.find((entry) => entry.id === id);
    const key = link?.user_id;

    if (key) set((state) => ({ busy: { ...state.busy, [key]: true } }));

    const { error } = await supabase.rpc('respond_friend_request', {
      p_id: id,
      p_accept: accept,
    });

    if (error) set({ notice: { tone: 'error', text: errorMessage(error) } });

    if (key) {
      set((state) => {
        const busy = { ...state.busy };
        delete busy[key];
        return { busy };
      });
    }

    await get().load();
  },

  remove: async (userId) => {
    set((state) => ({ busy: { ...state.busy, [userId]: true } }));

    const { error } = await supabase.rpc('remove_friend', { p_user_id: userId });
    if (error) set({ notice: { tone: 'error', text: errorMessage(error) } });

    set((state) => {
      const busy = { ...state.busy };
      delete busy[userId];
      return { busy };
    });

    await get().load();
  },

  block: async (userId) => {
    set((state) => ({ busy: { ...state.busy, [userId]: true } }));

    const { error } = await supabase.rpc('block_user', { p_user_id: userId });
    if (error) set({ notice: { tone: 'error', text: errorMessage(error) } });

    set((state) => {
      const busy = { ...state.busy };
      delete busy[userId];
      return { busy };
    });

    await get().load();
  },

  unblock: async (userId) => {
    set((state) => ({ busy: { ...state.busy, [userId]: true } }));

    const { error } = await supabase.rpc('unblock_user', { p_user_id: userId });
    if (error) set({ notice: { tone: 'error', text: errorMessage(error) } });

    set((state) => {
      const busy = { ...state.busy };
      delete busy[userId];
      return { busy };
    });

    await get().load();
  },

  clearNotice: () => set({ notice: null }),

  reset: () => set({ ...EMPTY, loading: false, error: null, notice: null, busy: {} }),
}));

/* -------------------------------------------------------------------------- */
/* Recherche                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Filtre une liste sur le pseudo et le nom affiche.
 *
 * Les accents sont retires des deux cotes : chercher « eleonore » doit trouver
 * « Éléonore », faute de quoi la barre de recherche ne servirait qu'a ceux qui
 * savent deja taper le nom exact.
 */
export function matchProfile(profile: Profile | undefined, query: string): boolean {
  if (!profile) return false;

  const needle = fold(query);
  if (needle === '') return true;

  return fold(profile.username).includes(needle) || fold(profile.display_name).includes(needle);
}

function fold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}
