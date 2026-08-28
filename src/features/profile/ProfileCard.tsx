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
 * Elle ne montre aucun compteur d'activite. Le nombre de messages ecrits ne
 * renseigne sur personne, et place sous un visage il se lit comme une note.
 * Ce qu'on garde repond a la question qu'on se pose vraiment en ouvrant une
 * fiche : qui est cette personne, et d'ou est-ce que je la connais.
 */

const ROLE_ICON: Record<SpaceRole, IconName> = {
  owner: 'sparkles',
  admin: 'settings',
  moderator: 'filter',
  member: 'users',
};

export function ProfileCard({ userId }: { userId: UUID }) {
  const profiles = useChat((state) => state.profiles);
  const openDm = useChat((state) => state.openDm);
  const me = useSession((state) => state.profile);
  const animate = useSession((state) => state.preferences.animateAvatars);
  const openModal = useUI((state) => state.openModal);
  const closeModal = useUI((state) => state.closeModal);
  const selectChannel = useUI((state) => state.selectChannel);
  const selectSpace = useUI((state) => state.selectSpace);
  const showDirectMessages = useUI((state) => state.showDirectMessages);
  const [opening, setOpening] = useState(false);

  const [stats, setStats] = useState<ProfileStats | null>(null);
  const [onglet, setOnglet] = useState<'apropos' | 'espaces' | 'amis'>('apropos');
  const profile = profiles[userId] ?? (userId === me?.id ? me : undefined);

  useEffect(() => {
    setOnglet('apropos');
  }, [userId]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const { data } = await supabase.rpc('profile_stats', { p_user_id: userId });
      if (cancelled || !data) return;

      /*
       * La fonction SQL peut dater d'avant la migration qui a remplace les
       * compteurs par la liste des espaces communs. Elle renvoie alors un objet
       * sans `mutual_spaces`, et lire `.length` dessus ferait disparaitre toute
       * la fiche. On normalise plutot que de faire confiance a la forme.
       */
      const brut = data as Partial<ProfileStats>;
      setStats({
        joined_at: brut.joined_at ?? new Date().toISOString(),
        mutual_spaces: Array.isArray(brut.mutual_spaces) ? brut.mutual_spaces : [],
        mutual_friends: Array.isArray(brut.mutual_friends) ? brut.mutual_friends : [],
        roles: Array.isArray(brut.roles) ? brut.roles : [],
      });
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

  const espaces = stats?.mutual_spaces ?? [];
  const amis = stats?.mutual_friends ?? [];

  /*
   * Les onglets communs n'existent que sur la fiche de quelqu'un d'autre.
   *
   * « Espaces en commun » avec soi-meme voudrait dire tous ses espaces, et
   * « amis en commun » tous ses amis : deux listes qu'on a deja ailleurs, et
   * qui n'apprennent rien ici.
   */
  const onglets = isMe
    ? ([{ id: 'apropos', label: 'A propos' }] as const)
    : ([
        { id: 'apropos', label: 'A propos' },
        { id: 'espaces', label: `Espaces (${espaces.length})` },
        { id: 'amis', label: `Amis (${amis.length})` },
      ] as const);
  const cardStyle =
    typeof hue === 'number' ? ({ '--hue-primary': hue } as React.CSSProperties) : undefined;

  return (
    <div className="profile" style={cardStyle}>
      {/*
        La banniere, floue, en fond de toute la fiche.
        Elle donne sa couleur a l'ensemble sans jamais disputer la lecture :
        floutee a ce point, il n'en reste que des masses colorees. Le texte
        passe dessus sur un voile sombre, jamais sur l'image nette.
      */}
      <div className="profile__wash" aria-hidden="true">
        {profile.banner_url ? (
          <img src={profile.banner_url} alt="" className="profile__wash-image" />
        ) : (
          <span className="profile__wash-fallback" />
        )}
      </div>

      <TiltCard className="profile__card" glare>
        {/* Elle coiffe la fiche entiere : une banniere est faite pour etre
            large, et confinee a la colonne de gauche on n'en voyait qu'un
            tiers. */}
        <div className="profile__banner">
          {profile.banner_url ? (
            isAnimatable(profile.banner_url) ? (
          <AnimatedImage
            src={profile.banner_url}
            alt=""
            className="profile__banner-image"
            // Ouvrir une fiche est deja un geste delibere : la banniere
            // s'anime sans qu'il faille en plus la survoler.
            // « Jamais » reste respecte — c'est une demande, pas un
            // defaut.
            mode={animate === 'never' ? 'never' : 'always'}
          />
            ) : (
          <img src={profile.banner_url} alt="" className="profile__banner-image" />
            )
          ) : (
            <span className="profile__banner-fallback" />
          )}

          {isMe ? (
            <button
          type="button"
          className="profile__banner-edit"
          onClick={() => openModal({ kind: 'edit-profile' })}
            >
          <Icon name="camera" size={15} />
          Changer
            </button>
          ) : null}
        </div>

        <div className="profile__grid">
          <div className="profile__aside">
            <div className="profile__avatar">
              {isMe ? (
                <button
                  type="button"
                  className="profile__avatar-edit"
                  onClick={() => openModal({ kind: 'edit-profile' })}
                  aria-label="Changer ma photo de profil"
                >
                  <Avatar profile={profile} size={96} status={profile.status} showStatus />
                  <span className="profile__avatar-veil" aria-hidden="true">
                    <Icon name="camera" size={20} />
                  </span>
                </button>
              ) : (
                <Avatar profile={profile} size={96} status={profile.status} showStatus />
              )}
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

            {profile.custom_status ? (
              <p className="profile__status">{profile.custom_status}</p>
            ) : null}

            {isMe ? (
              <button
                type="button"
                className="btn btn--primary profile__action"
                onClick={() => openModal({ kind: 'edit-profile' })}
              >
                <Icon name="edit" size={15} />
                Modifier mon profil
              </button>
            ) : (
              <button
                type="button"
                className="btn btn--primary profile__action"
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

            <p className="profile__since">
              {stats
                ? `Parmi nous depuis le ${new Intl.DateTimeFormat('fr-FR', {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  }).format(new Date(stats.joined_at))}`
                : ' '}
            </p>
          </div>

          {/*
            La colonne de droite change de contenu, la gauche jamais.
            Bio, espaces et amis ne se regardent pas en meme temps : les
            empiler faisait defiler une carte qui tient largement en hauteur.
          */}
          <div className="profile__main">
            <nav className="profile__tabs" aria-label="Sections du profil">
              {onglets.map((entree) => (
                <button
                  key={entree.id}
                  type="button"
                  className={'profile__tab' + (onglet === entree.id ? ' is-active' : '')}
                  aria-current={onglet === entree.id ? 'page' : undefined}
                  onClick={() => setOnglet(entree.id)}
                >
                  {entree.label}
                </button>
              ))}
            </nav>

            <div className="profile__panel">
              {onglet === 'apropos' ? (
                <>
                  {profile.bio ? (
                    <p className="profile__bio">{profile.bio}</p>
                  ) : (
                    <p className="profile__empty">
                      {isMe
                        ? "Vous n'avez encore rien ecrit sur vous."
                        : "Cette personne n'a rien ecrit sur elle."}
                    </p>
                  )}

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
                </>
              ) : null}

              {onglet === 'espaces' ? (
                espaces.length === 0 ? (
                  <p className="profile__empty">
                    Vous ne partagez aucun espace. Cette fiche ne montre donc que
                    ce que cette personne a choisi d&rsquo;y ecrire.
                  </p>
                ) : (
                  <ul className="profile__mutual-list">
                    {espaces.map((space) => (
                      <li key={space.id}>
                        <button
                          type="button"
                          className="profile-mutual"
                          onClick={() => {
                            selectSpace(space.id);
                            closeModal();
                          }}
                        >
                          {space.icon_url ? (
                            <img src={space.icon_url} alt="" className="profile-mutual__icon" />
                          ) : (
                            <span
                              className="profile-mutual__icon profile-mutual__icon--letter"
                              style={{ background: hueFor(space.id) }}
                              aria-hidden="true"
                            >
                              {space.name.slice(0, 1).toUpperCase()}
                            </span>
                          )}
                          <span className="truncate">{space.name}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )
              ) : null}

              {onglet === 'amis' ? (
                amis.length === 0 ? (
                  <p className="profile__empty">Aucune connaissance commune.</p>
                ) : (
                  <ul className="profile__mutual-list">
                    {amis.map((ami) => (
                      <li key={ami.id}>
                        <button
                          type="button"
                          className="profile-mutual"
                          onClick={() => openModal({ kind: 'profile', userId: ami.id })}
                        >
                          <Avatar profile={ami as Profile} size={32} />
                          <span className="truncate">{ami.display_name}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )
              ) : null}
            </div>
          </div>
        </div>
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
