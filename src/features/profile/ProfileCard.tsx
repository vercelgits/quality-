import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useChat } from '@/store/chat';
import { useSession } from '@/store/session';
import { useUI } from '@/store/ui';
import { TiltCard } from '@/components/TiltCard';
import { Avatar } from '@/components/Avatar';
import { Icon, type IconName } from '@/components/Icon';
import { hueFor } from '@/constants';
import { ROLE_LABEL, type Profile, type ProfileStats, type SpaceRole, type UUID } from '@/types/db';
import { AnimatedImage, isAnimatable } from '@/components/AnimatedImage';

/**
 * Carte de profil.
 *
 * Les chiffres viennent de `profile_stats`, qui compte a la demande en
 * respectant les politiques RLS : deux personnes ne voient donc pas
 * forcement le meme total, puisqu'on ne compte que ce qu'on a le droit de lire.
 */

const ROLE_ICON: Record<SpaceRole, IconName> = {
  owner: 'sparkles',
  admin: 'settings',
  moderator: 'filter',
  member: 'users',
};

const STAT_LABELS: { key: keyof ProfileStats; label: string; icon: IconName }[] = [
  { key: 'messages', label: 'Messages', icon: 'thread' },
  { key: 'threads_opened', label: 'Fils ouverts', icon: 'inbox' },
  { key: 'reactions_given', label: 'Reactions', icon: 'smile' },
  { key: 'shared_spaces', label: 'Espaces en commun', icon: 'compass' },
];

export function ProfileCard({ userId }: { userId: UUID }) {
  const profiles = useChat((state) => state.profiles);
  const openDm = useChat((state) => state.openDm);
  const me = useSession((state) => state.profile);
  const animate = useSession((state) => state.preferences.animateAvatars);
  const openModal = useUI((state) => state.openModal);
  const closeModal = useUI((state) => state.closeModal);
  const selectChannel = useUI((state) => state.selectChannel);
  const showDirectMessages = useUI((state) => state.showDirectMessages);
  const [opening, setOpening] = useState(false);

  const [stats, setStats] = useState<ProfileStats | null>(null);
  const profile = profiles[userId] ?? (userId === me?.id ? me : undefined);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const { data } = await supabase.rpc('profile_stats', { p_user_id: userId });
      if (!cancelled && data) setStats(data as ProfileStats);
    })();

    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (!profile) {
    return (
      <div className="empty">
        <span className="empty__icon">
          <Icon name="users" size={26} />
        </span>
        <p className="empty__title">Profil introuvable</p>
        <p className="empty__body">
          Cette personne ne partage aucun espace avec vous, ou son compte a ete
          supprime.
        </p>
      </div>
    );
  }

  const isMe = profile.id === me?.id;

  // Ces champs viennent d'une migration qui peut ne pas encore etre appliquee :
  // `to_jsonb(profiles.*)` ne renvoie que les colonnes existantes, donc ils
  // arrivent alors en `undefined` plutot qu'en `null`.
  const hue = profile.theme_hue ?? null;
  const links = profile.links ?? [];
  const cardStyle =
    typeof hue === 'number' ? ({ '--hue-primary': hue } as React.CSSProperties) : undefined;

  return (
    <div className="profile" style={cardStyle}>
      <TiltCard className="profile__card" glare>
        <div className="profile__banner">
          {profile.banner_url ? (
            isAnimatable(profile.banner_url) ? (
              <AnimatedImage
                src={profile.banner_url}
                alt=""
                className="profile__banner-image"
                // Ouvrir une fiche de profil est deja un geste deliberе : la
                // banniere s'anime sans qu'il faille en plus la survoler.
                // « Jamais » reste respecte — c'est une demande, pas un defaut.
                mode={animate === 'never' ? 'never' : 'always'}
              />
            ) : (
              <img src={profile.banner_url} alt="" className="profile__banner-image" />
            )
          ) : (
            <span className="profile__banner-fallback" aria-hidden="true" />
          )}
        </div>

        <div className="profile__avatar">
          <Avatar profile={profile} size={92} status={profile.status} showStatus />
        </div>

        <div className="profile__identity">
          <h2 className="profile__name">{profile.display_name}</h2>
          <p className="profile__handle">
            @{profile.username}
            {profile.pronouns ? (
              <>
                <span className="profile__dot" aria-hidden="true">
                  ·
                </span>
                {profile.pronouns}
              </>
            ) : null}
          </p>
        </div>

        {profile.custom_status ? (
          <p className="profile__status">{profile.custom_status}</p>
        ) : null}

        {stats && stats.roles.length > 0 ? (
          <ul className="profile__badges">
            {stats.roles.map((role) => (
              <li key={role} className={`profile-badge profile-badge--${role}`}>
                <Icon name={ROLE_ICON[role]} size={13} />
                {ROLE_LABEL[role]}
              </li>
            ))}
          </ul>
        ) : null}

        {profile.bio ? <p className="profile__bio">{profile.bio}</p> : null}

        {links.length > 0 ? (
          <ul className="profile__links">
            {links.map((link) => (
              <li key={link.url}>
                <a
                  className="profile-link"
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                >
                  <Icon name="link" size={13} />
                  <span className="truncate">{link.label}</span>
                </a>
              </li>
            ))}
          </ul>
        ) : null}

        <div className="profile__stats">
          {STAT_LABELS.map((item) => (
            <div className="profile-stat" key={item.key}>
              <span className="profile-stat__icon" aria-hidden="true">
                <Icon name={item.icon} size={15} />
              </span>
              <span className="profile-stat__value">
                {stats ? (
                  new Intl.NumberFormat('fr-FR').format(Number(stats[item.key] ?? 0))
                ) : (
                  <span className="skeleton profile-stat__skeleton" />
                )}
              </span>
              <span className="profile-stat__label">{item.label}</span>
            </div>
          ))}
        </div>

        <p className="profile__since">
          {stats
            ? `Parmi nous depuis le ${new Intl.DateTimeFormat('fr-FR', {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              }).format(new Date(stats.joined_at))}`
            : ' '}
        </p>

        {isMe ? (
          <button
            type="button"
            className="btn btn--primary btn--block"
            onClick={() => openModal({ kind: 'edit-profile' })}
          >
            <Icon name="edit" size={15} />
            Modifier mon profil
          </button>
        ) : (
          <button
            type="button"
            className="btn btn--primary btn--block"
            disabled={opening}
            onClick={() => {
              setOpening(true);
              void openDm(profile.id).then((channel) => {
                setOpening(false);
                if (!channel) return;
                showDirectMessages();
                selectChannel(channel.id);
                closeModal();
              });
            }}
          >
            {opening ? <span className="spinner" /> : <Icon name="send" size={15} />}
            Envoyer un message
          </button>
        )}
      </TiltCard>
    </div>
  );
}

/** Vignette compacte, utilisee dans les listes de membres. */
export function ProfileTile({
  profile,
  role,
  onOpen,
}: {
  profile: Profile;
  role?: SpaceRole;
  onOpen: (id: UUID) => void;
}) {
  return (
    <button type="button" className="card card--interactive member-tile" onClick={() => onOpen(profile.id)}>
      <span
        className="member-tile__wash"
        style={{ background: hueFor(profile.id) }}
        aria-hidden="true"
      />
      <Avatar profile={profile} size={44} status={profile.status} showStatus />

      <span className="member-tile__body">
        <span className="member-tile__name truncate">{profile.display_name}</span>
        <span className="member-tile__handle truncate">
          {profile.custom_status ?? `@${profile.username}`}
        </span>
      </span>

      {role && role !== 'member' ? (
        <span className={`profile-badge profile-badge--${role}`}>
          <Icon name={ROLE_ICON[role]} size={12} />
          {ROLE_LABEL[role]}
        </span>
      ) : null}
    </button>
  );
}
