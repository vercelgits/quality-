import { useEffect, useState } from 'react';
import { Modal } from '@/components/Modal';
import { ModerationPanel } from '@/features/moderation/ModerationPanel';
import { ReportModal } from '@/features/moderation/ReportModal';
import { PollComposer } from '@/features/polls/PollComposer';
import { BookmarksModal } from '@/features/bookmarks/BookmarksModal';
import { ProfileCard } from '@/features/profile/ProfileCard';
import { ProfileEditor } from '@/features/profile/ProfileEditor';
import { NewDmModal } from '@/features/dm/NewDmModal';
import { SpaceSettings } from '@/features/spaces/SpaceSettings';
import { Icon } from '@/components/Icon';
import { useUI } from '@/store/ui';
import { useChat } from '@/store/chat';
import { supabase } from '@/lib/supabase';
import type { UUID } from '@/types/db';
import { LIMITS } from '@/constants';

/** Point d'entree unique : affiche la boite de dialogue demandee par l'etat. */
export function Modals() {
  const modal = useUI((state) => state.modal);
  const closeModal = useUI((state) => state.closeModal);

  return (
    <>
      <CreateSpaceModal open={modal.kind === 'create-space'} onClose={closeModal} />
      <JoinSpaceModal open={modal.kind === 'join-space'} onClose={closeModal} />
      <CreateChannelModal
        open={modal.kind === 'create-channel'}
        spaceId={modal.kind === 'create-channel' ? modal.spaceId : null}
        onClose={closeModal}
      />
      <InviteModal
        open={modal.kind === 'invite'}
        spaceId={modal.kind === 'invite' ? modal.spaceId : null}
        onClose={closeModal}
      />
      <ProfileModal
        open={modal.kind === 'profile'}
        userId={modal.kind === 'profile' ? modal.userId : null}
        onClose={closeModal}
      />
      <ModerationPanel
        open={modal.kind === 'moderation'}
        spaceId={modal.kind === 'moderation' ? modal.spaceId : null}
        onClose={closeModal}
      />
      <ReportModal
        open={modal.kind === 'report'}
        messageId={modal.kind === 'report' ? modal.messageId : null}
        onClose={closeModal}
      />
      <PollComposer
        open={modal.kind === 'poll'}
        channelId={modal.kind === 'poll' ? modal.channelId : null}
        threadId={modal.kind === 'poll' ? modal.threadId : null}
        onClose={closeModal}
      />
      <ChannelSettingsModal
        open={modal.kind === 'channel-settings'}
        channelId={modal.kind === 'channel-settings' ? modal.channelId : null}
        onClose={closeModal}
      />
      <BookmarksModal open={modal.kind === 'bookmarks'} onClose={closeModal} />
      <ProfileEditor open={modal.kind === 'edit-profile'} onClose={closeModal} />
      <NewDmModal open={modal.kind === 'new-dm'} onClose={closeModal} />
      <SpaceSettings
        open={modal.kind === 'space-settings'}
        spaceId={modal.kind === 'space-settings' ? modal.spaceId : null}
        onClose={closeModal}
      />
    </>
  );
}

/* ========================================================================== */
/* Creation d'espace                                                          */
/* ========================================================================== */

function CreateSpaceModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const createSpace = useChat((state) => state.createSpace);
  const selectSpace = useUI((state) => state.selectSpace);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setName('');
      setDescription('');
    }
  }, [open]);

  const submit = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    const space = await createSpace(name.trim(), description.trim() || undefined);
    setBusy(false);
    if (space) {
      selectSpace(space.id);
      onClose();
    }
  };

  return (
    <Modal
      open={open}
      title="Creer un espace"
      description="Un espace regroupe des salons et des personnes."
      onClose={onClose}
      footer={
        <>
          <div className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Annuler
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={!name.trim() || busy}
            onClick={() => void submit()}
          >
            {busy ? <span className="spinner" /> : null}
            Creer
          </button>
        </>
      }
    >
      <div className="field">
        <label className="field__label" htmlFor="space-name">
          Nom
        </label>
        <input
          id="space-name"
          className="input"
          value={name}
          maxLength={LIMITS.spaceNameLength}
          placeholder="Equipe produit"
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => event.key === 'Enter' && void submit()}
        />
      </div>

      <div className="field">
        <label className="field__label" htmlFor="space-description">
          Description
        </label>
        <input
          id="space-description"
          className="input"
          value={description}
          maxLength={280}
          placeholder="Facultatif"
          onChange={(event) => setDescription(event.target.value)}
        />
      </div>

      <p className="field__hint">
        Un salon <strong>#general</strong> et un salon vocal sont crees automatiquement.
      </p>
    </Modal>
  );
}

/* ========================================================================== */
/* Rejoindre un espace                                                        */
/* ========================================================================== */

function JoinSpaceModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const joinSpace = useChat((state) => state.joinSpace);
  const selectSpace = useUI((state) => state.selectSpace);

  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (open) {
      setCode('');
      setFailed(false);
    }
  }, [open]);

  const submit = async () => {
    if (!code.trim() || busy) return;
    setBusy(true);
    setFailed(false);
    const space = await joinSpace(code.trim());
    setBusy(false);

    if (space) {
      selectSpace(space.id);
      onClose();
    } else {
      setFailed(true);
    }
  };

  return (
    <Modal
      open={open}
      title="Rejoindre un espace"
      description="Collez le code d’invitation qu’on vous a transmis."
      onClose={onClose}
      footer={
        <>
          <div className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Annuler
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={!code.trim() || busy}
            onClick={() => void submit()}
          >
            {busy ? <span className="spinner" /> : null}
            Rejoindre
          </button>
        </>
      }
    >
      <div className="field">
        <label className="field__label" htmlFor="invite-code">
          Code d’invitation
        </label>
        <input
          id="invite-code"
          className="input"
          value={code}
          placeholder="a1b2c3d4e5f6"
          onChange={(event) => setCode(event.target.value)}
          onKeyDown={(event) => event.key === 'Enter' && void submit()}
          autoComplete="off"
          spellCheck={false}
        />
        {failed ? (
          <p className="field__error">Ce code ne correspond a aucun espace.</p>
        ) : null}
      </div>
    </Modal>
  );
}

/* ========================================================================== */
/* Creation de salon                                                          */
/* ========================================================================== */

function CreateChannelModal({
  open,
  spaceId,
  onClose,
}: {
  open: boolean;
  spaceId: string | null;
  onClose: () => void;
}) {
  const createChannel = useChat((state) => state.createChannel);

  const [name, setName] = useState('');
  const [kind, setKind] = useState<'text' | 'voice'>('text');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setName('');
      setKind('text');
    }
  }, [open]);

  const submit = async () => {
    if (!spaceId || !name.trim() || busy) return;
    setBusy(true);
    // Un nom de salon textuel suit la convention en minuscules avec tirets, ce
    // qui rend les references `#salon` previsibles.
    const clean =
      kind === 'text'
        ? name.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9_-]/g, '')
        : name.trim();
    await createChannel(spaceId, clean || 'salon', kind);
    setBusy(false);
    onClose();
  };

  return (
    <Modal
      open={open}
      title="Nouveau salon"
      onClose={onClose}
      footer={
        <>
          <div className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Annuler
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={!name.trim() || busy}
            onClick={() => void submit()}
          >
            Creer
          </button>
        </>
      }
    >
      <div className="field">
        <span className="field__label">Type</span>
        <div className="segmented">
          <button
            type="button"
            className={'segmented__item' + (kind === 'text' ? ' is-active' : '')}
            onClick={() => setKind('text')}
          >
            <Icon name="hash" size={15} />
            Texte
          </button>
          <button
            type="button"
            className={'segmented__item' + (kind === 'voice' ? ' is-active' : '')}
            onClick={() => setKind('voice')}
          >
            <Icon name="volume" size={15} />
            Vocal
          </button>
        </div>
      </div>

      <div className="field">
        <label className="field__label" htmlFor="channel-name">
          Nom
        </label>
        <input
          id="channel-name"
          className="input"
          value={name}
          maxLength={LIMITS.channelNameLength}
          placeholder={kind === 'text' ? 'annonces' : 'Salon vocal'}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => event.key === 'Enter' && void submit()}
        />
      </div>
    </Modal>
  );
}

/* ========================================================================== */
/* Invitation                                                                 */
/* ========================================================================== */

function InviteModal({
  open,
  spaceId,
  onClose,
}: {
  open: boolean;
  spaceId: string | null;
  onClose: () => void;
}) {
  const spaces = useChat((state) => state.spaces);
  const space = spaces.find((item) => item.id === spaceId) ?? null;

  const [copied, setCopied] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [code, setCode] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setCopied(false);
      setCode(space?.invite_code ?? null);
    }
  }, [open, space?.invite_code]);

  const copy = async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Le presse-papiers peut etre refuse : le code reste selectionnable.
    }
  };

  const rotate = async () => {
    if (!spaceId) return;
    setRotating(true);
    const { data } = await supabase.rpc('rotate_invite_code', { p_space_id: spaceId });
    setRotating(false);
    if (typeof data === 'string') setCode(data);
  };

  return (
    <Modal
      open={open}
      title={`Inviter dans ${space?.name ?? ''}`}
      description="Toute personne disposant de ce code peut rejoindre l’espace."
      onClose={onClose}
    >
      <div className="invite">
        <code className="invite__code">{code ?? '—'}</code>
        <button type="button" className="btn btn--sm" onClick={() => void copy()}>
          <Icon name={copied ? 'check' : 'copy'} size={14} />
          {copied ? 'Copie' : 'Copier'}
        </button>
      </div>

      <p className="field__hint" style={{ marginTop: 'var(--space-4)' }}>
        Si ce code a circule trop loin, regenerez-le : l’ancien cesse aussitot de
        fonctionner, sans affecter les membres deja presents.
      </p>

      <button
        type="button"
        className="btn btn--sm"
        style={{ marginTop: 'var(--space-3)' }}
        onClick={() => void rotate()}
        disabled={rotating}
      >
        {rotating ? <span className="spinner" /> : <Icon name="refresh" size={14} />}
        Regenerer le code
      </button>
    </Modal>
  );
}

/* ========================================================================== */
/* Profil                                                                     */
/* ========================================================================== */

function ProfileModal({
  open,
  userId,
  onClose,
}: {
  open: boolean;
  userId: string | null;
  onClose: () => void;
}) {
  // La carte se suffit a elle-meme : la boite ne porte ni titre ni chrome, pour
  // que la banniere touche le bord et que la carte reste l'objet principal.
  return (
    <Modal open={open} title="Profil" onClose={onClose} width={860} bare>
      {userId ? <ProfileCard userId={userId} /> : null}
    </Modal>
  );
}

/* ========================================================================== */
/* Notifications                                                              */
/* ========================================================================== */


/* ========================================================================== */
/* Reglages d'un salon                                                        */
/* ========================================================================== */

/**
 * Renommer ou supprimer un salon.
 *
 * La suppression demande de retaper le nom du salon. C'est une friction
 * volontaire : elle emporte tous les messages et rien ne les ramene, alors
 * qu'une simple confirmation se clique sans lire.
 */
function ChannelSettingsModal({
  open,
  channelId,
  onClose,
}: {
  open: boolean;
  channelId: UUID | null;
  onClose: () => void;
}) {
  const channels = useChat((state) => state.channels);
  const renameChannel = useChat((state) => state.renameChannel);
  const deleteChannel = useChat((state) => state.deleteChannel);
  const selectSpace = useUI((state) => state.selectSpace);

  const channel = channels.find((item) => item.id === channelId) ?? null;

  const [name, setName] = useState('');
  const [topic, setTopic] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || !channel) return;
    setName(channel.name);
    setTopic(channel.topic ?? '');
    setConfirmation('');
  }, [open, channel?.id]);

  if (!channel) return null;

  const renamed = name.trim() !== '' && (name.trim() !== channel.name || topic !== (channel.topic ?? ''));
  const confirmed = confirmation.trim() === channel.name;

  const save = async () => {
    setBusy(true);
    const done = await renameChannel(channel.id, name.trim(), topic.trim() || null);
    setBusy(false);
    if (done) onClose();
  };

  const remove = async () => {
    setBusy(true);
    const spaceId = await deleteChannel(channel.id);
    setBusy(false);

    if (spaceId) {
      // Le salon vient de disparaitre : rester dessus laisserait une vue vide.
      selectSpace(spaceId);
      onClose();
    }
  };

  return (
    <Modal
      open={open}
      title={`Reglages de ${channel.name}`}
      onClose={onClose}
      width={520}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Fermer
          </button>
          <div className="spacer" />
          <button
            type="button"
            className="btn btn--primary"
            disabled={!renamed || busy}
            onClick={() => void save()}
          >
            {busy ? <span className="spinner" /> : null}
            Enregistrer
          </button>
        </>
      }
    >
      <div className="field">
        <label className="field__label" htmlFor="channel-rename">
          Nom
        </label>
        <input
          id="channel-rename"
          className="input"
          value={name}
          maxLength={LIMITS.channelNameLength}
          onChange={(event) => setName(event.target.value)}
        />
      </div>

      {channel.kind === 'text' ? (
        <div className="field">
          <label className="field__label" htmlFor="channel-topic">
            Sujet
          </label>
          <input
            id="channel-topic"
            className="input"
            value={topic}
            maxLength={LIMITS.topicLength}
            placeholder="De quoi parle-t-on ici ?"
            onChange={(event) => setTopic(event.target.value)}
          />
        </div>
      ) : null}

      <hr className="divider" />

      <section className="danger-zone">
        <h3 className="danger-zone__title">Supprimer ce salon</h3>
        <p className="danger-zone__body">
          Tous les messages, fichiers et fils de ce salon partent avec lui, sans
          retour possible. Tapez <strong>{channel.name}</strong> pour confirmer.
        </p>

        <div className="danger-zone__row">
          <input
            className="input"
            value={confirmation}
            placeholder={channel.name}
            aria-label={`Tapez ${channel.name} pour confirmer la suppression`}
            onChange={(event) => setConfirmation(event.target.value)}
          />
          <button
            type="button"
            className="btn btn--danger"
            disabled={!confirmed || busy}
            onClick={() => void remove()}
          >
            <Icon name="trash" size={14} />
            Supprimer
          </button>
        </div>
      </section>
    </Modal>
  );
}
