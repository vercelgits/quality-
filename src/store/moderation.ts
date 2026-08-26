import { create } from 'zustand';
import { supabase, errorMessage } from '@/lib/supabase';
import { useChat } from './chat';
import type {
  Channel,
  MessageReport,
  ModerationEntry,
  SpaceBan,
  SpaceRole,
  SpaceTimeout,
  UUID,
} from '@/types/db';

/**
 * Etat de la console de moderation.
 *
 * Il est tenu a part de `useChat` parce qu'il ne concerne qu'une poignee de
 * personnes et n'est charge qu'a l'ouverture du panneau : garder bannissements,
 * signalements et journal dans l'etat principal les ferait transiter a chaque
 * demarrage pour tout le monde, sans usage.
 *
 * Chaque action passe par une fonction SQL qui revalide la hierarchie. Ce que
 * l'on decide ici ne sert donc qu'a afficher les bons boutons : la base refuse
 * de toute facon ce qu'elle doit refuser.
 */

interface ModerationState {
  spaceId: UUID | null;
  loading: boolean;
  error: string | null;

  bans: SpaceBan[];
  timeouts: SpaceTimeout[];
  reports: MessageReport[];
  log: ModerationEntry[];

  load: (spaceId: UUID) => Promise<void>;
  clear: () => void;

  setRole: (spaceId: UUID, userId: UUID, role: SpaceRole) => Promise<boolean>;
  kick: (spaceId: UUID, userId: UUID, reason: string) => Promise<boolean>;
  ban: (spaceId: UUID, userId: UUID, reason: string, days: number | null) => Promise<boolean>;
  unban: (spaceId: UUID, userId: UUID) => Promise<boolean>;
  timeout: (spaceId: UUID, userId: UUID, minutes: number, reason: string) => Promise<boolean>;
  clearTimeout: (spaceId: UUID, userId: UUID) => Promise<boolean>;

  setChannelModeration: (
    channelId: UUID,
    patch: { locked?: boolean; slowmode?: number },
  ) => Promise<void>;

  deleteMessageAsModerator: (messageId: UUID, reason: string) => Promise<boolean>;
  resolveReport: (reportId: UUID, status: 'resolved' | 'dismissed') => Promise<void>;
}

export const useModeration = create<ModerationState>((set, get) => {
  /** Rejoue le chargement apres une action, pour refleter son effet. */
  async function refresh(): Promise<void> {
    const spaceId = get().spaceId;
    if (spaceId) await get().load(spaceId);
  }

  /**
   * Enveloppe commune : remonte l'erreur et signale la reussite.
   *
   * Le parametre est un `PromiseLike` et non un `Promise` : les constructeurs
   * de requete Supabase sont attendables mais ne sont pas de vraies promesses,
   * et ne satisfont donc pas l'interface complete.
   */
  async function run(
    call: () => PromiseLike<{ error: { message?: string } | null }>,
  ): Promise<boolean> {
    const { error } = await call();
    if (error) {
      set({ error: errorMessage(error) });
      return false;
    }
    set({ error: null });
    await refresh();
    return true;
  }

  return {
    spaceId: null,
    loading: false,
    error: null,

    bans: [],
    timeouts: [],
    reports: [],
    log: [],

    load: async (spaceId) => {
      set({ spaceId, loading: true });

      // Les quatre lectures sont independantes : les lancer ensemble evite
      // quatre allers-retours en file.
      const [bans, timeouts, reports, log] = await Promise.all([
        supabase.from('space_bans').select('*').eq('space_id', spaceId),
        supabase.from('space_timeouts').select('*').eq('space_id', spaceId),
        supabase
          .from('message_reports')
          .select('*')
          .eq('space_id', spaceId)
          .eq('status', 'open')
          .order('created_at', { ascending: false }),
        supabase
          .from('moderation_log')
          .select('*')
          .eq('space_id', spaceId)
          .order('created_at', { ascending: false })
          .limit(100),
      ]);

      set({
        loading: false,
        bans: (bans.data ?? []) as SpaceBan[],
        // Une exclusion expiree reste en base jusqu'au prochain passage : on la
        // filtre a l'affichage plutot que d'ajouter une tache de nettoyage.
        timeouts: ((timeouts.data ?? []) as SpaceTimeout[]).filter(
          (item) => new Date(item.expires_at).getTime() > Date.now(),
        ),
        reports: (reports.data ?? []) as MessageReport[],
        log: (log.data ?? []) as ModerationEntry[],
      });
    },

    clear: () => set({ spaceId: null, bans: [], timeouts: [], reports: [], log: [], error: null }),

    setRole: (spaceId, userId, role) =>
      run(() =>
        supabase.rpc('set_member_role', {
          p_space_id: spaceId,
          p_user_id: userId,
          p_role: role,
        }),
      ).then(async (ok) => {
        // Le rang change la liste des membres affichee partout ailleurs.
        if (ok) await useChat.getState().bootstrap();
        return ok;
      }),

    kick: (spaceId, userId, reason) =>
      run(() =>
        supabase.rpc('kick_member', {
          p_space_id: spaceId,
          p_user_id: userId,
          p_reason: reason || null,
        }),
      ).then(async (ok) => {
        if (ok) await useChat.getState().bootstrap();
        return ok;
      }),

    ban: (spaceId, userId, reason, days) =>
      run(() =>
        supabase.rpc('ban_member', {
          p_space_id: spaceId,
          p_user_id: userId,
          p_reason: reason || null,
          p_expires_at:
            days === null
              ? null
              : new Date(Date.now() + days * 86_400_000).toISOString(),
        }),
      ).then(async (ok) => {
        if (ok) await useChat.getState().bootstrap();
        return ok;
      }),

    unban: (spaceId, userId) =>
      run(() => supabase.rpc('unban_member', { p_space_id: spaceId, p_user_id: userId })),

    timeout: (spaceId, userId, minutes, reason) =>
      run(() =>
        supabase.rpc('timeout_member', {
          p_space_id: spaceId,
          p_user_id: userId,
          p_minutes: minutes,
          p_reason: reason || null,
        }),
      ),

    clearTimeout: (spaceId, userId) =>
      run(() => supabase.rpc('clear_timeout', { p_space_id: spaceId, p_user_id: userId })),

    setChannelModeration: async (channelId, patch) => {
      const { data, error } = await supabase.rpc('set_channel_moderation', {
        p_channel_id: channelId,
        p_locked: patch.locked ?? null,
        p_slowmode: patch.slowmode ?? null,
      });

      if (error) {
        set({ error: errorMessage(error) });
        return;
      }
      if (data) useChat.getState().applyChannel(data as Channel);
      await refresh();
    },

    deleteMessageAsModerator: (messageId, reason) =>
      run(() =>
        supabase.rpc('moderate_delete_message', {
          p_message_id: messageId,
          p_reason: reason || null,
        }),
      ),

    resolveReport: async (reportId, status) => {
      const { error } = await supabase.rpc('resolve_report', {
        p_report_id: reportId,
        p_status: status,
      });
      if (error) {
        set({ error: errorMessage(error) });
        return;
      }
      set((state) => ({ reports: state.reports.filter((item) => item.id !== reportId) }));
    },
  };
});
