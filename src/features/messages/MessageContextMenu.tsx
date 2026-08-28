import { ContextMenu, type MenuEntry, type MenuPosition } from '@/components/ContextMenu';
import { Icon } from '@/components/Icon';
import { QUICK_REACTIONS } from '@/constants';
import type { Message, UUID } from '@/types/db';

/**
 * Actions sur un message, au clic droit.
 *
 * Le clic droit ouvrait les actions de l'auteur, pas celles du message : on y
 * cherchait « repondre » ou « epingler » et on tombait sur « bloquer ». Les
 * deux ont leur place, mais dans cet ordre — le message d'abord, puisque c'est
 * lui qu'on a vise.
 *
 * Ce qui retire quelque chose est en rouge et en dernier. Sur le message de
 * quelqu'un d'autre, « Supprimer » cede la place a « Signaler » : sans droit
 * de moderation on ne peut pas effacer la parole d'autrui, et proposer un
 * bouton qui echouerait vaut moins que proposer celui qui aboutit.
 */

export function MessageContextMenu({
  message,
  position,
  onClose,
  mine,
  canManage,
  bookmarked,
  onReply,
  onEdit,
  onDelete,
  onReact,
  onPin,
  onStartThread,
  onBookmark,
  onReport,
  onOpenAuthor,
}: {
  message: Message;
  position: MenuPosition;
  onClose: () => void;
  mine: boolean;
  canManage: boolean;
  bookmarked: boolean;
  onReply: (id: UUID) => void;
  onEdit: (id: UUID) => void;
  onDelete: (id: UUID) => void;
  onReact: (id: UUID, emoji: string) => void;
  onPin: (id: UUID) => void;
  onStartThread: (id: UUID) => void;
  onBookmark: (id: UUID) => void;
  onReport: (id: UUID) => void;
  onOpenAuthor: () => void;
}) {
  const entrees: MenuEntry[] = [];

  // Les reactions rapides en tete : c'est l'action la plus frequente, et la
  // plus penible a atteindre autrement — il faut sinon survoler puis viser une
  // icone de seize pixels.
  for (const emoji of QUICK_REACTIONS.slice(0, 4)) {
    entrees.push({
      id: `reaction-${emoji}`,
      label: `Reagir avec ${emoji}`,
      icon: <span aria-hidden="true">{emoji}</span>,
      onSelect: () => onReact(message.id, emoji),
    });
  }

  entrees.push({ id: 'sep-repondre', separator: true });

  entrees.push({
    id: 'repondre',
    label: 'Repondre',
    icon: <Icon name="reply" size={15} />,
    onSelect: () => onReply(message.id),
  });

  entrees.push({
    id: 'fil',
    label: 'Ouvrir un fil',
    icon: <Icon name="thread" size={15} />,
    onSelect: () => onStartThread(message.id),
  });

  if (mine) {
    entrees.push({
      id: 'modifier',
      label: 'Modifier le message',
      icon: <Icon name="edit" size={15} />,
      onSelect: () => onEdit(message.id),
    });
  }

  entrees.push({ id: 'sep-copier', separator: true });

  entrees.push({
    id: 'copier-texte',
    label: 'Copier le texte',
    icon: <Icon name="copy" size={15} />,
    // Un message sans texte — une piece jointe seule — n'a rien a copier.
    disabled: message.content.trim().length === 0,
    onSelect: () => void navigator.clipboard.writeText(message.content),
  });

  entrees.push({
    id: 'copier-lien',
    label: 'Copier le lien du message',
    icon: <Icon name="link" size={15} />,
    onSelect: () => {
      const lien = `${window.location.origin}/#/message/${message.id}`;
      void navigator.clipboard.writeText(lien);
    },
  });

  entrees.push({
    id: 'copier-id',
    label: "Copier l'identifiant",
    icon: <Icon name="hash" size={15} />,
    onSelect: () => void navigator.clipboard.writeText(message.id),
  });

  entrees.push({ id: 'sep-ranger', separator: true });

  entrees.push({
    id: 'epingler',
    label: message.pinned ? 'Retirer des epingles' : 'Epingler le message',
    icon: <Icon name="pin" size={15} />,
    onSelect: () => onPin(message.id),
  });

  entrees.push({
    id: 'garder',
    label: bookmarked ? 'Retirer de mes messages' : 'Sauvegarder le message',
    icon: <Icon name="inbox" size={15} />,
    onSelect: () => onBookmark(message.id),
  });

  entrees.push({ id: 'sep-auteur', separator: true });

  entrees.push({
    id: 'auteur',
    label: "Voir le profil de l'auteur",
    icon: <Icon name="user-check" size={15} />,
    onSelect: onOpenAuthor,
  });

  entrees.push({ id: 'sep-grave', separator: true });

  /*
   * La derniere entree, en rouge, depend de qui a ecrit.
   *
   * Sur son propre message : supprimer. Sur celui d'un autre : signaler —
   * sauf pour la moderation, qui peut les deux et a besoin des deux.
   */
  if (mine || canManage) {
    entrees.push({
      id: 'supprimer',
      label: 'Supprimer le message',
      icon: <Icon name="trash" size={15} />,
      danger: true,
      onSelect: () => onDelete(message.id),
    });
  }

  if (!mine) {
    entrees.push({
      id: 'signaler',
      label: 'Signaler le message',
      icon: <Icon name="shield" size={15} />,
      danger: true,
      onSelect: () => onReport(message.id),
    });
  }

  return (
    <ContextMenu
      position={position}
      entries={entrees}
      onClose={onClose}
      label="Actions sur le message"
    />
  );
}
