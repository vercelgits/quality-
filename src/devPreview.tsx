import type { ReactNode } from 'react';
import { FriendsPage } from '@/features/friends/FriendsPage';
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

  if (name.startsWith('parametres')) {
    const section = name.split(':')[1] ?? 'compte';
    useUI.getState().openSettings(section as SettingsSection);
    return <SettingsPage />;
  }

  return null;
}
