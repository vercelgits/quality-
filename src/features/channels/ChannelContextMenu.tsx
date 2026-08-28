import { ContextMenu, type MenuEntry, type MenuPosition } from '@/components/ContextMenu';
import { Icon } from '@/components/Icon';
import { useChat } from '@/store/chat';
import { useUI } from '@/store/ui';
import type { Channel } from '@/types/db';

/**
 * Actions sur un salon, au clic droit.
 *
 * Les reglages n'etaient atteignables que par une roue dentee qui n'apparait
 * qu'au survol, et seulement pour qui peut administrer : les autres n'avaient
 * aucun moyen de marquer un salon comme lu ou d'en copier le lien.
 *
 * Ce qui detruit est en rouge, en dernier, et separe du reste — pour que le
 * geste demande de viser.
 */

export function ChannelContextMenu({
  channel,
  position,
  onClose,
  canManage,
  onDelete,
}: {
  channel: Channel;
  position: MenuPosition;
  onClose: () => void;
  canManage: boolean;
  onDelete: () => void;
}) {
  const markRead = useChat((state) => state.markRead);
  const readStates = useChat((state) => state.readStates);
  const openModal = useUI((state) => state.openModal);
  const selectChannel = useUI((state) => state.selectChannel);

  const nonLus = readStates[channel.id]?.unread_count ?? 0;

  const entrees: MenuEntry[] = [
    {
      id: 'ouvrir',
      label: 'Ouvrir le salon',
      icon: <Icon name={channel.kind === 'voice' ? 'volume' : 'hash'} size={15} />,
      onSelect: () => selectChannel(channel.id),
    },
    {
      id: 'lu',
      label: 'Marquer comme lu',
      icon: <Icon name="check-circle" size={15} />,
      disabled: nonLus === 0,
      onSelect: () => void markRead(channel.id),
    },

    { id: 'sep-copier', separator: true },

    {
      id: 'copier-lien',
      label: 'Copier le lien du salon',
      icon: <Icon name="link" size={15} />,
      onSelect: () => {
        void navigator.clipboard.writeText(
          `${window.location.origin}/#/salon/${channel.id}`,
        );
      },
    },
    {
      id: 'copier-nom',
      label: 'Copier le nom',
      icon: <Icon name="copy" size={15} />,
      onSelect: () => void navigator.clipboard.writeText(channel.name),
    },
    {
      id: 'copier-id',
      label: "Copier l'identifiant",
      icon: <Icon name="hash" size={15} />,
      onSelect: () => void navigator.clipboard.writeText(channel.id),
    },
  ];

  if (canManage) {
    entrees.push(
      { id: 'sep-gerer', separator: true },
      {
        id: 'renommer',
        label: 'Renommer et regler',
        icon: <Icon name="edit" size={15} />,
        onSelect: () => openModal({ kind: 'channel-settings', channelId: channel.id }),
      },
      {
        id: 'inviter',
        label: 'Inviter dans cet espace',
        icon: <Icon name="user-plus" size={15} />,
        disabled: channel.space_id === null,
        onSelect: () => {
          if (channel.space_id) openModal({ kind: 'invite', spaceId: channel.space_id });
        },
      },

      { id: 'sep-grave', separator: true },
      {
        id: 'supprimer',
        label: 'Supprimer le salon',
        icon: <Icon name="trash" size={15} />,
        danger: true,
        onSelect: onDelete,
      },
    );
  }

  return (
    <ContextMenu
      position={position}
      entries={entrees}
      onClose={onClose}
      label={`Actions sur ${channel.name}`}
    />
  );
}
