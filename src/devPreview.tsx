import type { ReactNode } from 'react';
import { FriendsPage } from '@/features/friends/FriendsPage';
import { ProfileCard } from '@/features/profile/ProfileCard';
import { useChat } from '@/store/chat';
import { ProfileEditor } from '@/features/profile/ProfileEditor';
import { useSession } from '@/store/session';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { useUI, type SettingsSection } from '@/store/ui';

/**
 * Apercu d'un ecran isole, en developpement seulement.
 *
 * Les pages des amis et des parametres ne s'atteignent qu'une fois connecte :
 * verifier leur mise en page demanderait un compte a chaque retouche de style.
 * `?preview=amis` ou `?preview=parametres:voix` les affiche a vide.
 *
 * Les magasins ne sont pas alimentes : ce sont les etats vides que l'on voit,
 * ce qui est justement le cas le plus facile a laisser se degrader.
 *
 * Ce module n'est importe que sous `import.meta.env.DEV`, valeur figee a la
 * compilation : rien de tout cela ne part dans le paquet livre.
 */
export function devPreview(name: string): ReactNode | null {
  if (name === 'amis') return <FriendsPage />;

  if (name === 'profil' || name === 'profil:moi') {
    // Un profil rempli, pose directement dans le magasin : la carte se lit mal
    // a vide, or c'est justement la version pleine — banniere, bio, liens,
    // espaces en commun — qu'il faut regarder quand on retouche sa mise en
    // page.
    const faux = {
      id: '00000000-0000-4000-8000-000000000001',
      username: 'lumine',
      display_name: 'Lumine',
      avatar_url: null,
      banner_url: null,
      bio: "Je lis plus que je n'ecris. Ping-moi si quelque chose brule.",
      pronouns: 'elle',
      custom_status: 'Au calme jusqu’a jeudi',
      status: 'online',
      theme_hue: 268,
      links: [{ label: 'lumine.example', url: 'https://lumine.example' }],
      username_chosen: true,
      created_at: '2025-03-14T10:00:00.000Z',
    };

    useChat.setState((state) => ({ profiles: { ...state.profiles, [faux.id]: faux as never } }));

    /*
     * `?preview=profil:moi` ouvre sa PROPRE fiche.
     *
     * C'est un autre rendu : l'avatar y est enveloppe dans un bouton, la
     * banniere porte « Changer », et les onglets communs disparaissent. Ce
     * chemin n'etait couvert par aucun apercu, et c'est precisement celui que
     * l'on voit tous les jours.
     */
    if (name.endsWith(':moi')) useSession.setState({ profile: faux as never });

    // La largeur de la boite qui l'accueille dans l'application : sans elle,
    // la carte s'etale sur tout l'ecran et sa mise en page n'a plus rien a
    // voir avec ce que l'on verra.
    return (
      <div style={{ maxWidth: 960, margin: '0 auto' }}>
        <ProfileCard userId={faux.id} />
      </div>
    );
  }

  if (name === 'editeur' || name.startsWith('parametres')) {
    // Ces ecrans ne s'ouvrent qu'une fois connecte. Sans profil dans le
    // magasin, « Mon compte » ne rend rien du tout — soit exactement l'ecran
    // qu'on cherche a verifier.
    const faux = {
      id: '00000000-0000-4000-8000-000000000002',
      username: 'zyko682',
      display_name: 'ex',
      avatar_url: null,
      banner_url: null,
      bio: null,
      pronouns: null,
      custom_status: null,
      status: 'online',
      theme_hue: null,
      links: [],
      username_chosen: true,
      created_at: '2026-03-14T10:00:00.000Z',
    };

    useSession.setState({ profile: faux as never });

    if (name === 'editeur') return <ProfileEditor open onClose={() => {}} />;

    const section = name.split(':')[1] ?? 'compte';
    useUI.getState().openSettings(section as SettingsSection);
    return <SettingsPage />;
  }

  return null;
}
