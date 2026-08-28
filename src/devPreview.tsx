import type { ReactNode } from 'react';
import { FriendsPage } from '@/features/friends/FriendsPage';
import { ProfileCard } from '@/features/profile/ProfileCard';
import { useChat } from '@/store/chat';
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

  if (name === 'profil') {
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
    return <ProfileCard userId={faux.id} />;
  }

  if (name.startsWith('parametres')) {
    const section = name.split(':')[1] ?? 'compte';
    useUI.getState().openSettings(section as SettingsSection);
    return <SettingsPage />;
  }

  return null;
}
