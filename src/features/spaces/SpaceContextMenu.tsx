import { ContextMenu, type MenuEntry, type MenuPosition } from '@/components/ContextMenu';
import { Icon } from '@/components/Icon';
import { useChat } from '@/store/chat';
import { useUI } from '@/store/ui';
import type { Space, SpaceRole } from '@/types/db';

/**
 * Actions sur un espace, au clic droit sur sa pastille.
 *
 * Inviter, regler, quitter : tout cela demandait d'entrer dans l'espace, puis
 * de trouver le bon bouton. Depuis le rail, un clic droit suffit.
 *
 * La derniere entree depend du rang. Le proprietaire ne peut pas quitter son
 * propre espace — il le laisserait sans personne pour l'administrer — on lui
 * propose donc de le supprimer, ce qui est une decision differente et se
 * confirme ailleurs, dans la zone sensible des reglages.
 */

export function SpaceContextMenu({
  space,
  role,
  position,
  onClose,
  onLeave,
}: {
  space: Space;
  role: SpaceRole | undefined;
  position: MenuPosition;
  onClose: () => void;
  onLeave: () => void;
}) {
  const openModal = useUI((state) => state.openModal);
  const selectSpace = useUI((state) => state.selectSpace);
  const channels = useChat((state) => state.channels);
  const markRead = useChat((state) => state.markRead);
  const readStates = useChat((state) => state.readStates);

  const salons = channels.filter((channel) => channel.space_id === space.id);
  const nonLus = salons.reduce(
    (total, channel) => total + (readStates[channel.id]?.unread_count ?? 0),
    0,
  );

  const peutGerer = role === 'owner' || role === 'admin';

  const entrees: MenuEntry[] = [
    {
      id: 'ouvrir',
      label: 'Ouvrir',
      icon: <Icon name="compass" size={15} />,
      onSelect: () => selectSpace(space.id),
    },
    {
      id: 'lu',
      label: 'Tout marquer comme lu',
      icon: <Icon name="check-circle" size={15} />,
      disabled: nonLus === 0,
      // Un salon apres l'autre : il n'existe pas d'appel qui marque un espace
      // entier, et en fabriquer un pour ce menu serait disproportionne.
      onSelect: () => {
        for (const channel of salons) void markRead(channel.id);
      },
    },

    { id: 'sep-inviter', separator: true },

    {
      id: 'inviter',
      label: 'Inviter des personnes',
      icon: <Icon name="user-plus" size={15} />,
      onSelect: () => openModal({ kind: 'invite', spaceId: space.id }),
    },
    {
      id: 'moderation',
      label: 'Moderation',
      icon: <Icon name="shield" size={15} />,
      disabled: !peutGerer,
      onSelect: () => openModal({ kind: 'moderation', spaceId: space.id }),
    },
    {
      id: 'reglages',
      label: "Parametres de l'espace",
      icon: <Icon name="settings" size={15} />,
      disabled: !peutGerer,
      onSelect: () => openModal({ kind: 'space-settings', spaceId: space.id }),
    },

    { id: 'sep-copier', separator: true },

    {
      id: 'copier-nom',
      label: 'Copier le nom',
      icon: <Icon name="copy" size={15} />,
      onSelect: () => void navigator.clipboard.writeText(space.name),
    },
    {
      id: 'copier-id',
      label: "Copier l'identifiant",
      icon: <Icon name="hash" size={15} />,
      onSelect: () => void navigator.clipboard.writeText(space.id),
    },

    { id: 'sep-grave', separator: true },
  ];

  if (role === 'owner') {
    entrees.push({
      id: 'supprimer',
      label: "Supprimer l'espace",
      icon: <Icon name="trash" size={15} />,
      danger: true,
      // La suppression se confirme dans la zone sensible : elle demande de
      // retaper le nom, et ce n'est pas une decision qu'un menu doit sceller.
      onSelect: () => openModal({ kind: 'space-settings', spaceId: space.id }),
    });
  } else {
    entrees.push({
      id: 'quitter',
      label: "Quitter l'espace",
      icon: <Icon name="log-out" size={15} />,
      danger: true,
      onSelect: onLeave,
    });
  }

  return (
    <ContextMenu
      position={position}
      entries={entrees}
      onClose={onClose}
      label={`Actions sur ${space.name}`}
    />
  );
}
