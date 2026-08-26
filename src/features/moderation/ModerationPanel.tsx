import { useEffect, useMemo, useState } from 'react';
import { useModeration } from '@/store/moderation';
import { useChat } from '@/store/chat';
import { useSession } from '@/store/session';
import { Modal } from '@/components/Modal';
import { Icon } from '@/components/Icon';
import { Avatar } from '@/components/Avatar';
import { formatRelative, formatFull } from '@/lib/time';
import { RANK, ROLE_LABEL, type SpaceRole, type UUID } from '@/types/db';

type Tab = 'members' | 'reports' | 'bans' | 'channels' | 'log';

const TABS: { id: Tab; label: string; icon: 'users' | 'filter' | 'trash' | 'hash' | 'inbox' }[] = [
  { id: 'members', label: 'Membres', icon: 'users' },
  { id: 'reports', label: 'Signalements', icon: 'filter' },
  { id: 'bans', label: 'Bannis', icon: 'trash' },
  { id: 'channels', label: 'Salons', icon: 'hash' },
  { id: 'log', label: 'Journal', icon: 'inbox' },
];

const TIMEOUT_PRESETS = [
  { minutes: 5, label: '5 min' },
  { minutes: 60, label: '1 h' },
  { minutes: 60 * 24, label: '1 jour' },
  { minutes: 60 * 24 * 7, label: '1 semaine' },
];

export function ModerationPanel({
  open,
  spaceId,
  onClose,
}: {
  open: boolean;
  spaceId: UUID | null;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>('members');

  const load = useModeration((state) => state.load);
  const clear = useModeration((state) => state.clear);
  const error = useModeration((state) => state.error);
  const loading = useModeration((state) => state.loading);

  const spaces = useChat((state) => state.spaces);
  const ranks = useChat((state) => state.ranks);

  const space = spaces.find((item) => item.id === spaceId) ?? null;
  const myRank = spaceId ? (ranks[spaceId] ?? 0) : 0;

  useEffect(() => {
    if (open && spaceId) void load(spaceId);
    if (!open) clear();
  }, [open, spaceId, load, clear]);

  const reportCount = useModeration((state) => state.reports.length);

  if (!spaceId || !space) return null;

  return (
    <Modal
      open={open}
      title={`Moderation — ${space.name}`}
      description="Les actions sont revalidees par la base : on n'agit jamais sur un rang egal ou superieur au sien."
      onClose={onClose}
      width={780}
    >
      <nav className="mod-tabs" role="tablist">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            className={'mod-tab' + (tab === item.id ? ' is-active' : '')}
            onClick={() => setTab(item.id)}
          >
            <Icon name={item.icon} size={15} />
            {item.label}
            {item.id === 'reports' && reportCount > 0 ? (
              <span className="badge">{reportCount}</span>
            ) : null}
          </button>
        ))}
      </nav>

      {error ? (
        <p className="mod-error" role="alert">
          <Icon name="x" size={14} />
          {error}
        </p>
      ) : null}

      {loading ? (
        <div className="mod-loading">
          <span className="spinner" />
        </div>
      ) : (
        <>
          {tab === 'members' ? <MembersTab spaceId={spaceId} myRank={myRank} /> : null}
          {tab === 'reports' ? <ReportsTab /> : null}
          {tab === 'bans' ? <BansTab spaceId={spaceId} /> : null}
          {tab === 'channels' ? <ChannelsTab spaceId={spaceId} /> : null}
          {tab === 'log' ? <LogTab /> : null}
        </>
      )}
    </Modal>
  );
}

/* ========================================================================== */
/* Membres                                                                    */
/* ========================================================================== */

function MembersTab({ spaceId, myRank }: { spaceId: UUID; myRank: number }) {
  const members = useChat((state) => state.members);
  const profiles = useChat((state) => state.profiles);
  const myId = useSession((state) => state.profile?.id);

  const timeouts = useModeration((state) => state.timeouts);
  const setRole = useModeration((state) => state.setRole);
  const kick = useModeration((state) => state.kick);
  const ban = useModeration((state) => state.ban);
  const applyTimeout = useModeration((state) => state.timeout);
  const clearTimeoutFor = useModeration((state) => state.clearTimeout);

  const [expanded, setExpanded] = useState<UUID | null>(null);
  const [reason, setReason] = useState('');

  const timeoutByUser = useMemo(
    () => new Map(timeouts.map((item) => [item.user_id, item])),
    [timeouts],
  );

  const rows = useMemo(
    () =>
      members
        .filter((member) => member.space_id === spaceId)
        .map((member) => ({ member, profile: profiles[member.user_id] }))
        .filter((row) => row.profile !== undefined)
        .sort((a, b) => {
          const delta = RANK[b.member.role] - RANK[a.member.role];
          return delta !== 0
            ? delta
            : a.profile!.display_name.localeCompare(b.profile!.display_name, 'fr');
        }),
    [members, profiles, spaceId],
  );

  return (
    <ul className="mod-list">
      {rows.map(({ member, profile }) => {
        const theirRank = RANK[member.role];
        // On n'agit que sur un rang strictement inferieur, et jamais sur soi.
        const actionable = myRank > theirRank && profile!.id !== myId;
        const isOpen = expanded === profile!.id;
        const muted = timeoutByUser.get(profile!.id);

        return (
          <li key={profile!.id} className="mod-row">
            <div className="mod-row__head">
              <Avatar profile={profile} size={34} status={profile!.status} showStatus />

              <div className="mod-row__identity">
                <span className="mod-row__name">{profile!.display_name}</span>
                <span className="mod-row__handle">@{profile!.username}</span>
              </div>

              <span className={'mod-role mod-role--' + member.role}>
                {ROLE_LABEL[member.role]}
              </span>

              {muted ? (
                <span className="chip" title={formatFull(muted.expires_at)}>
                  <Icon name="mic-off" size={12} />
                  Muet {formatRelative(muted.expires_at)}
                </span>
              ) : null}

              {actionable ? (
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => {
                    setExpanded(isOpen ? null : profile!.id);
                    setReason('');
                  }}
                  aria-expanded={isOpen}
                  aria-label="Actions de moderation"
                >
                  <Icon name={isOpen ? 'chevron-down' : 'more'} size={16} />
                </button>
              ) : (
                <span
                  className="mod-row__locked"
                  title={
                    profile!.id === myId
                      ? 'Vous ne pouvez pas vous moderer vous-meme'
                      : 'Rang egal ou superieur au votre'
                  }
                >
                  <Icon name="check-circle" size={15} />
                </span>
              )}
            </div>

            {isOpen && actionable ? (
              <div className="mod-actions">
                <div className="field">
                  <label className="field__label" htmlFor={`reason-${profile!.id}`}>
                    Motif (conserve dans le journal)
                  </label>
                  <input
                    id={`reason-${profile!.id}`}
                    className="input"
                    value={reason}
                    maxLength={500}
                    placeholder="Spam repete dans #general"
                    onChange={(event) => setReason(event.target.value)}
                  />
                </div>

                <div className="mod-actions__group">
                  <span className="mod-actions__label">Reduire au silence</span>
                  <div className="mod-actions__row">
                    {TIMEOUT_PRESETS.map((preset) => (
                      <button
                        key={preset.minutes}
                        type="button"
                        className="btn btn--sm"
                        onClick={() =>
                          void applyTimeout(spaceId, profile!.id, preset.minutes, reason)
                        }
                      >
                        {preset.label}
                      </button>
                    ))}
                    {muted ? (
                      <button
                        type="button"
                        className="btn btn--sm btn--ghost"
                        onClick={() => void clearTimeoutFor(spaceId, profile!.id)}
                      >
                        <Icon name="refresh" size={12} />
                        Rendre la parole
                      </button>
                    ) : null}
                  </div>
                </div>

                <div className="mod-actions__group">
                  <span className="mod-actions__label">Rang</span>
                  <div className="mod-actions__row">
                    {(['member', 'moderator', 'admin'] as SpaceRole[]).map((role) => (
                      <button
                        key={role}
                        type="button"
                        className={
                          'btn btn--sm' + (member.role === role ? ' btn--primary' : '')
                        }
                        // Nommer a un rang qu'on n'a pas depasse soi-meme est
                        // refuse par la base : autant ne pas le proposer.
                        disabled={RANK[role] >= myRank || member.role === role}
                        onClick={() => void setRole(spaceId, profile!.id, role)}
                      >
                        {ROLE_LABEL[role]}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="mod-actions__group">
                  <span className="mod-actions__label">Exclure</span>
                  <div className="mod-actions__row">
                    <button
                      type="button"
                      className="btn btn--sm"
                      onClick={() => void kick(spaceId, profile!.id, reason)}
                      title="Retire de l'espace, mais peut revenir avec une invitation"
                    >
                      <Icon name="log-out" size={12} />
                      Exclure
                    </button>
                    <button
                      type="button"
                      className="btn btn--sm"
                      onClick={() => void ban(spaceId, profile!.id, reason, 7)}
                    >
                      Bannir 7 jours
                    </button>
                    <button
                      type="button"
                      className="btn btn--sm btn--danger"
                      onClick={() => void ban(spaceId, profile!.id, reason, null)}
                    >
                      Bannir definitivement
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/* ========================================================================== */
/* Signalements                                                               */
/* ========================================================================== */

function ReportsTab() {
  const reports = useModeration((state) => state.reports);
  const resolveReport = useModeration((state) => state.resolveReport);
  const deleteMessage = useModeration((state) => state.deleteMessageAsModerator);
  const profiles = useChat((state) => state.profiles);

  if (reports.length === 0) {
    return (
      <div className="panel-empty">
        <Icon name="check-circle" size={26} />
        <p>Aucun signalement en attente.</p>
      </div>
    );
  }

  return (
    <ul className="mod-list">
      {reports.map((report) => {
        const reporter = profiles[report.reporter_id];
        return (
          <li key={report.id} className="mod-row">
            <div className="mod-row__head">
              <Avatar profile={reporter} size={28} />
              <div className="mod-row__identity">
                <span className="mod-row__name">
                  Signale par {reporter?.display_name ?? 'quelqu’un'}
                </span>
                <span className="mod-row__handle">{formatRelative(report.created_at)}</span>
              </div>
            </div>

            <p className="mod-report__reason">{report.reason}</p>

            <div className="mod-actions__row">
              <button
                type="button"
                className="btn btn--sm btn--danger"
                onClick={() => {
                  void deleteMessage(report.message_id, report.reason);
                  void resolveReport(report.id, 'resolved');
                }}
              >
                <Icon name="trash" size={12} />
                Supprimer le message
              </button>
              <button
                type="button"
                className="btn btn--sm"
                onClick={() => void resolveReport(report.id, 'resolved')}
              >
                Traite
              </button>
              <button
                type="button"
                className="btn btn--sm btn--ghost"
                onClick={() => void resolveReport(report.id, 'dismissed')}
              >
                Sans suite
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/* ========================================================================== */
/* Bannis                                                                     */
/* ========================================================================== */

function BansTab({ spaceId }: { spaceId: UUID }) {
  const bans = useModeration((state) => state.bans);
  const unban = useModeration((state) => state.unban);
  const profiles = useChat((state) => state.profiles);

  if (bans.length === 0) {
    return (
      <div className="panel-empty">
        <Icon name="users" size={26} />
        <p>Personne n’est banni de cet espace.</p>
      </div>
    );
  }

  return (
    <ul className="mod-list">
      {bans.map((entry) => {
        const profile = profiles[entry.user_id];
        return (
          <li key={entry.user_id} className="mod-row">
            <div className="mod-row__head">
              <Avatar profile={profile} size={30} />
              <div className="mod-row__identity">
                <span className="mod-row__name">
                  {profile?.display_name ?? entry.user_id.slice(0, 8)}
                </span>
                <span className="mod-row__handle">
                  {entry.expires_at
                    ? `Jusqu’${formatRelative(entry.expires_at)}`
                    : 'Definitif'}
                  {entry.reason ? ` · ${entry.reason}` : ''}
                </span>
              </div>
              <button
                type="button"
                className="btn btn--sm"
                onClick={() => void unban(spaceId, entry.user_id)}
              >
                Lever le bannissement
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/* ========================================================================== */
/* Salons                                                                     */
/* ========================================================================== */

const SLOWMODE_PRESETS = [0, 5, 15, 60, 300, 900];

function ChannelsTab({ spaceId }: { spaceId: UUID }) {
  const channels = useChat((state) => state.channels);
  const setChannelModeration = useModeration((state) => state.setChannelModeration);

  const textChannels = channels.filter(
    (channel) => channel.space_id === spaceId && channel.kind === 'text',
  );

  return (
    <ul className="mod-list">
      {textChannels.map((channel) => (
        <li key={channel.id} className="mod-row">
          <div className="mod-row__head">
            <Icon name="hash" size={16} />
            <div className="mod-row__identity">
              <span className="mod-row__name">{channel.name}</span>
              <span className="mod-row__handle">
                {channel.locked ? 'Verrouille' : 'Ouvert'}
                {channel.slowmode_seconds > 0
                  ? ` · mode lent ${channel.slowmode_seconds} s`
                  : ''}
              </span>
            </div>
            <button
              type="button"
              className={'btn btn--sm' + (channel.locked ? ' btn--primary' : '')}
              onClick={() =>
                void setChannelModeration(channel.id, { locked: !channel.locked })
              }
            >
              {channel.locked ? 'Deverrouiller' : 'Verrouiller'}
            </button>
          </div>

          <div className="mod-actions__group">
            <span className="mod-actions__label">Mode lent</span>
            <div className="mod-actions__row">
              {SLOWMODE_PRESETS.map((seconds) => (
                <button
                  key={seconds}
                  type="button"
                  className={
                    'btn btn--sm' +
                    (channel.slowmode_seconds === seconds ? ' btn--primary' : '')
                  }
                  onClick={() => void setChannelModeration(channel.id, { slowmode: seconds })}
                >
                  {seconds === 0
                    ? 'Aucun'
                    : seconds < 60
                      ? `${seconds} s`
                      : `${seconds / 60} min`}
                </button>
              ))}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

/* ========================================================================== */
/* Journal                                                                    */
/* ========================================================================== */

const ACTION_LABEL: Record<string, string> = {
  role_change: 'a change le rang de',
  kick: 'a exclu',
  ban: 'a banni',
  unban: 'a leve le bannissement de',
  timeout: 'a reduit au silence',
  timeout_cleared: 'a rendu la parole a',
  channel_moderation: 'a modifie un salon',
  message_delete: 'a supprime un message de',
};

function LogTab() {
  const log = useModeration((state) => state.log);
  const profiles = useChat((state) => state.profiles);

  if (log.length === 0) {
    return (
      <div className="panel-empty">
        <Icon name="inbox" size={26} />
        <p>Le journal est vide.</p>
      </div>
    );
  }

  return (
    <ol className="mod-log">
      {log.map((entry) => {
        const actor = entry.actor_id ? profiles[entry.actor_id] : undefined;
        const target = entry.target_id ? profiles[entry.target_id] : undefined;

        return (
          <li key={entry.id} className="mod-log__item">
            <span className="mod-log__time" title={formatFull(entry.created_at)}>
              {formatRelative(entry.created_at)}
            </span>
            <span className="mod-log__text">
              <strong>{actor?.display_name ?? 'Quelqu’un'}</strong>{' '}
              {ACTION_LABEL[entry.action] ?? entry.action}
              {target ? <strong> {target.display_name}</strong> : null}
              {entry.reason ? <span className="mod-log__reason"> — {entry.reason}</span> : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
