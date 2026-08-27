import { hueFor, initialsFor } from '@/constants';
import { AnimatedImage, isAnimatable } from '@/components/AnimatedImage';
import { useSession } from '@/store/session';
import type { PresenceStatus, Profile } from '@/types/db';

const STATUS_LABEL: Record<PresenceStatus, string> = {
  online: 'En ligne',
  idle: 'Absent',
  dnd: 'Ne pas deranger',
  offline: 'Hors ligne',
};

interface AvatarProps {
  profile: Pick<Profile, 'id' | 'display_name' | 'avatar_url'> | undefined;
  size?: number;
  status?: PresenceStatus;
  /** Affiche la pastille de presence. */
  showStatus?: boolean;
}

/**
 * Avatar avec repli sur les initiales.
 *
 * La couleur vient du profil et non d'un hachage calcule a l'affichage : elle
 * est donc identique partout, y compris entre deux appareils, ce qui aide a
 * reconnaitre quelqu'un du coin de l'oeil.
 */
export function Avatar({ profile, size = 38, status, showStatus = false }: AvatarProps) {
  const animate = useSession((state) => state.preferences.animateAvatars);
  const name = profile?.display_name ?? '?';
  // La teinte vient de l'identifiant et non du nom : renommer quelqu'un ne
  // change donc pas la nuance a laquelle on l'a associe.
  const seed = profile?.id ?? name;

  return (
    <span className="avatar" style={{ width: size, height: size }}>
      {profile?.avatar_url ? (
        // Le composant anime ne sert que pour un format qui peut l'etre :
        // pour un PNG il ajouterait un canevas et un rendu pour rien.
        isAnimatable(profile.avatar_url) ? (
          <AnimatedImage
            className="avatar__image"
            src={profile.avatar_url}
            alt=""
            mode={animate}
          />
        ) : (
          <img className="avatar__image" src={profile.avatar_url} alt="" loading="lazy" />
        )
      ) : (
        <span
          className="avatar__initials"
          style={{
            background: hueFor(seed),
            color: '#fff',
            fontSize: Math.max(9, Math.round(size * 0.36)),
          }}
          aria-hidden="true"
        >
          {initialsFor(name)}
        </span>
      )}

      {showStatus && status ? (
        <span
          className={`avatar__status avatar__status--${status}`}
          style={{ width: Math.max(8, size * 0.3), height: Math.max(8, size * 0.3) }}
          title={STATUS_LABEL[status]}
        >
          <span className="visually-hidden">{STATUS_LABEL[status]}</span>
        </span>
      ) : null}
    </span>
  );
}

/** Pile d'avatars, pour les participants d'un fil ou d'un salon vocal. */
export function AvatarStack({
  profiles,
  size = 22,
  max = 4,
}: {
  profiles: (Profile | undefined)[];
  size?: number;
  max?: number;
}) {
  const shown = profiles.filter(Boolean).slice(0, max);
  const extra = profiles.filter(Boolean).length - shown.length;

  return (
    <span className="avatar-stack">
      {shown.map((profile, index) => (
        <span
          key={profile?.display_name ?? index}
          className="avatar-stack__item"
          style={{ marginLeft: index === 0 ? 0 : -size * 0.32 }}
        >
          <Avatar profile={profile} size={size} />
        </span>
      ))}
      {extra > 0 ? (
        <span className="avatar-stack__extra" style={{ height: size, marginLeft: 4 }}>
          +{extra}
        </span>
      ) : null}
    </span>
  );
}
