import { ContextMenu, type MenuEntry, type MenuPosition } from '@/components/ContextMenu';
import { Icon } from '@/components/Icon';
import { useChat } from '@/store/chat';
import { useFriends } from '@/store/friends';
import { useSession } from '@/store/session';
import { useUI } from '@/store/ui';
import type { UUID } from '@/types/db';

/**
 * Actions disponibles sur une personne.
 *
 * Le meme menu partout — auteur d'un message, tuile vocale, liste des membres —
 * pour que le clic droit reponde toujours la meme chose. Les entrees qui
 * n'auraient pas de sens sont retirees plutot que grisees : proposer
 * « Ajouter en ami » a quelqu'un qui l'est deja n'informe personne.
 */
export function UserContextMenu({
  userId,
  position,
  onClose,
}: {
  userId: UUID;
  position: MenuPosition;
  onClose: () => void;
}) {
  const me = useSession((state) => state.profile);
  const profiles = useChat((state) => state.profiles);
  const openDm = useChat((state) => state.openDm);

  const amis = useFriends((state) => state.friends);
  const sortants = useFriends((state) => state.outgoing);
  const bloques = useFriends((state) => state.blocked);
  const envoyer = useFriends((state) => state.sendRequest);
  const bloquer = useFriends((state) => state.block);
  const debloquer = useFriends((state) => state.unblock);
  const retirer = useFriends((state) => state.remove);

  const openModal = useUI((state) => state.openModal);
  const selectChannel = useUI((state) => state.selectChannel);
  const openSettings = useUI((state) => state.openSettings);

  const profil = useFriends((state) => state.profiles[userId]) ?? profiles[userId];
  const estMoi = userId === me?.id;

  const dejaAmi = amis.some((lien) => lien.user_id === userId);
  const demandeEnvoyee = sortants.some((lien) => lien.user_id === userId);
  const estBloque = bloques.some((lien) => lien.user_id === userId);

  const entrees: MenuEntry[] = [
    {
      id: 'profil',
      label: estMoi ? 'Mon profil' : 'Voir le profil',
      icon: <Icon name="smile" size={15} />,
      onSelect: () =>
        estMoi ? openSettings('profil') : openModal({ kind: 'profile', userId }),
    },
  ];

  if (!estMoi) {
    entrees.push({
      id: 'message',
      label: 'Envoyer un message',
      icon: <Icon name="thread" size={15} />,
      // Bloque, la conversation est refusee par la base : mieux vaut ne pas
      // proposer un bouton qui affichera une erreur.
      disabled: estBloque,
      onSelect: () => {
        void openDm(userId).then((salon) => {
          if (salon) selectChannel(salon.id);
        });
      },
    });
  }

  if (profil) {
    entrees.push({
      id: 'copier',
      label: 'Copier le pseudo',
      icon: <Icon name="copy" size={15} />,
      onSelect: () => void navigator.clipboard.writeText(profil.username).catch(() => undefined),
    });
  }

  if (!estMoi) {
    entrees.push({ id: 'sep-amis', separator: true });

    if (estBloque) {
      entrees.push({
        id: 'debloquer',
        label: 'Debloquer',
        icon: <Icon name="shield-off" size={15} />,
        onSelect: () => void debloquer(userId),
      });
    } else {
      if (dejaAmi) {
        entrees.push({
          id: 'retirer',
          label: 'Retirer de mes amis',
          icon: <Icon name="user-x" size={15} />,
          danger: true,
          onSelect: () => void retirer(userId),
        });
      } else if (demandeEnvoyee) {
        entrees.push({
          id: 'annuler',
          label: 'Annuler la demande',
          icon: <Icon name="x" size={15} />,
          onSelect: () => void retirer(userId),
        });
      } else if (profil) {
        entrees.push({
          id: 'ajouter',
          label: 'Ajouter en ami',
          icon: <Icon name="user-plus" size={15} />,
          onSelect: () => void envoyer(profil.username),
        });
      }

      entrees.push({
        id: 'bloquer',
        label: 'Bloquer',
        icon: <Icon name="shield" size={15} />,
        danger: true,
        onSelect: () => void bloquer(userId),
      });
    }
  }

  return (
    <ContextMenu
      position={position}
      entries={entrees}
      onClose={onClose}
      label={profil ? `Actions pour ${profil.display_name}` : 'Actions'}
    />
  );
}
