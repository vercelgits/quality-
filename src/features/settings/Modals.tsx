import { useEffect, useState } from 'react';
import { Modal } from '@/components/Modal';
import { ModerationPanel } from '@/features/moderation/ModerationPanel';
import { ReportModal } from '@/features/moderation/ReportModal';
import { PollComposer } from '@/features/polls/PollComposer';
import { BookmarksModal } from '@/features/bookmarks/BookmarksModal';
import { ProfileCard } from '@/features/profile/ProfileCard';
import { ProfileEditor } from '@/features/profile/ProfileEditor';
import { Icon } from '@/components/Icon';
import { useUI } from '@/store/ui';
import { useChat } from '@/store/chat';
import { useSession, type AccentName, type Density, type Theme } from '@/store/session';
import { supabase } from '@/lib/supabase';
import { LIMITS } from '@/constants';
import {
  isDesktop,
  permissionState,
  requestPermission,
  type NotificationPermissionState,
} from '@/lib/notify';

/** Point d'entree unique : affiche la boite de dialogue demandee par l'etat. */
export function Modals() {
  const modal = useUI((state) => state.modal);
  const closeModal = useUI((state) => state.closeModal);

  return (
    <>
      <PreferencesModal open={modal.kind === 'preferences'} onClose={closeModal} />
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
      <BookmarksModal open={modal.kind === 'bookmarks'} onClose={closeModal} />
      <ProfileEditor open={modal.kind === 'edit-profile'} onClose={closeModal} />
    </>
  );
}

/* ========================================================================== */
/* Preferences                                                                */
/* ========================================================================== */

const THEMES: { value: Theme; label: string; icon: 'sun' | 'moon' | 'monitor' }[] = [
  { value: 'light', label: 'Clair', icon: 'sun' },
  { value: 'dark', label: 'Sombre', icon: 'moon' },
  { value: 'system', label: 'Systeme', icon: 'monitor' },
];

const ACCENTS: { value: AccentName; label: string }[] = [
  { value: 'indigo', label: 'Indigo' },
  { value: 'violet', label: 'Violet' },
  { value: 'ocean', label: 'Ocean' },
  { value: 'teal', label: 'Turquoise' },
  { value: 'forest', label: 'Foret' },
  { value: 'sunset', label: 'Couchant' },
  { value: 'rose', label: 'Rose' },
  { value: 'mono', label: 'Sans couleur' },
];

const DENSITIES: { value: Density; label: string; hint: string }[] = [
  { value: 'compact', label: 'Compacte', hint: 'Un maximum de messages a l’ecran' },
  { value: 'cozy', label: 'Confortable', hint: 'L’equilibre par defaut' },
  { value: 'spacious', label: 'Aeree', hint: 'Plus de respiration entre les lignes' },
];

function PreferencesModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const preferences = useSession((state) => state.preferences);
  const setPreference = useSession((state) => state.setPreference);
  const profile = useSession((state) => state.profile);
  const updateProfile = useSession((state) => state.updateProfile);
  const setStatus = useSession((state) => state.setStatus);
  const signOut = useSession((state) => state.signOut);

  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [customStatus, setCustomStatus] = useState('');

  useEffect(() => {
    if (!open || !profile) return;
    setDisplayName(profile.display_name);
    setBio(profile.bio ?? '');
    setCustomStatus(profile.custom_status ?? '');
  }, [open, profile]);

  const dirty =
    profile !== null &&
    (displayName !== profile.display_name ||
      bio !== (profile.bio ?? '') ||
      customStatus !== (profile.custom_status ?? ''));

  const save = async () => {
    if (!profile) return;
    await updateProfile({ display_name: displayName.trim(), bio: bio.trim() || null });
    await setStatus(profile.status, customStatus.trim() || null);
  };

  return (
    <Modal
      open={open}
      title="Preferences"
      onClose={onClose}
      width={560}
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={() => void signOut()}>
            <Icon name="log-out" size={14} />
            Se deconnecter
          </button>
          <div className="spacer" />
          <button
            type="button"
            className="btn btn--primary"
            disabled={!dirty}
            onClick={() => void save()}
          >
            Enregistrer
          </button>
        </>
      }
    >
      <section className="prefs__section">
        <h3 className="prefs__title">Profil</h3>

        <div className="field">
          <label className="field__label" htmlFor="pref-name">
            Nom affiche
          </label>
          <input
            id="pref-name"
            className="input"
            value={displayName}
            maxLength={LIMITS.displayNameLength}
            onChange={(event) => setDisplayName(event.target.value)}
          />
        </div>

        <div className="field">
          <label className="field__label" htmlFor="pref-status">
            Statut personnalise
          </label>
          <input
            id="pref-status"
            className="input"
            value={customStatus}
            maxLength={LIMITS.customStatusLength}
            placeholder="En reunion jusqu’a 15 h"
            onChange={(event) => setCustomStatus(event.target.value)}
          />
        </div>

        <div className="field">
          <label className="field__label" htmlFor="pref-bio">
            A propos
          </label>
          <textarea
            id="pref-bio"
            className="input"
            rows={3}
            value={bio}
            maxLength={280}
            onChange={(event) => setBio(event.target.value)}
          />
        </div>
      </section>

      <hr className="divider" />

      <section className="prefs__section">
        <h3 className="prefs__title">Apparence</h3>

        <div className="field">
          <span className="field__label">Theme</span>
          <div className="segmented">
            {THEMES.map((option) => (
              <button
                type="button"
                key={option.value}
                className={'segmented__item' + (preferences.theme === option.value ? ' is-active' : '')}
                onClick={() => setPreference('theme', option.value)}
                aria-pressed={preferences.theme === option.value}
              >
                <Icon name={option.icon} size={15} />
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <span className="field__label">Couleur de l’interface</span>
          <div className="hue-row">
            {ACCENTS.map((option) => (
              <button
                type="button"
                key={option.value}
                className={
                  'hue-dot hue-dot--theme' +
                  (preferences.accent === option.value ? ' is-active' : '')
                }
                data-accent-swatch={option.value}
                onClick={() => setPreference('accent', option.value)}
                title={option.label}
                aria-label={option.label}
                aria-pressed={preferences.accent === option.value}
              />
            ))}
          </div>
          <p className="field__hint">
            Une seule teinte de base : tout le reste en decoule, donc les contrastes
            restent corrects quel que soit votre choix.
          </p>
        </div>

        <div className="field">
          <span className="field__label">Densite d’affichage</span>
          <div className="prefs__options">
            {DENSITIES.map((option) => (
              <button
                type="button"
                key={option.value}
                className={'option-card' + (preferences.density === option.value ? ' is-active' : '')}
                onClick={() => setPreference('density', option.value)}
                aria-pressed={preferences.density === option.value}
              >
                <span className="option-card__label">{option.label}</span>
                <span className="option-card__hint">{option.hint}</span>
              </button>
            ))}
          </div>
        </div>
      </section>

      <hr className="divider" />

      <section className="prefs__section">
        <h3 className="prefs__title">Comportement</h3>

        <Toggle
          checked={preferences.sendOnEnter}
          onChange={(value) => setPreference('sendOnEnter', value)}
          label="Envoyer avec Entree"
          hint="Sinon, Entree insere un retour a la ligne et Ctrl+Entree envoie."
        />
        <Toggle
          checked={preferences.showTimestamps}
          onChange={(value) => setPreference('showTimestamps', value)}
          label="Heure sur chaque message"
          hint="Affiche l’heure meme sur les messages regroupes."
        />
        <Toggle
          checked={preferences.reduceMotion}
          onChange={(value) => setPreference('reduceMotion', value)}
          label="Reduire les animations"
          hint="Coupe les transitions, au-dela du reglage du systeme."
        />
      </section>

      <hr className="divider" />

      <section className="prefs__section">
        <h3 className="prefs__title">Notifications</h3>
        <NotificationSetting />
      </section>
    </Modal>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <label className="toggle">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="visually-hidden"
      />
      <span className={'toggle__track' + (checked ? ' is-on' : '')} aria-hidden="true">
        <span className="toggle__thumb" />
      </span>
      <span className="toggle__body">
        <span className="toggle__label">{label}</span>
        {hint ? <span className="toggle__hint">{hint}</span> : null}
      </span>
    </label>
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
    <Modal open={open} title="Profil" onClose={onClose} width={420} bare>
      {userId ? <ProfileCard userId={userId} /> : null}
    </Modal>
  );
}

/* ========================================================================== */
/* Notifications                                                              */
/* ========================================================================== */

/**
 * Autorisation des notifications de bureau.
 *
 * La demande n'est jamais faite automatiquement : les navigateurs penalisent
 * les sites qui la declenchent au chargement, et l'utilisateur refuse par
 * reflexe. Elle part donc d'un clic explicite.
 */
function NotificationSetting() {
  const [state, setState] = useState<NotificationPermissionState>('default');

  useEffect(() => {
    void permissionState().then(setState);
  }, []);

  if (state === 'unsupported') {
    return <p className="field__hint">Ce navigateur ne gere pas les notifications.</p>;
  }

  return (
    <div className="field">
      <p className="field__hint">
        Une bulle apparait uniquement quand on vous mentionne et que la fenetre
        n’est pas au premier plan.
        {isDesktop() ? ' Elle passe par le centre de notifications du systeme.' : ''}
      </p>

      {state === 'granted' ? (
        <p className="chip" style={{ alignSelf: 'flex-start' }}>
          <Icon name="check" size={13} />
          Notifications autorisees
        </p>
      ) : state === 'denied' ? (
        <p className="field__error">
          Notifications bloquees. Reautorisez-les depuis les reglages du site dans
          votre navigateur.
        </p>
      ) : (
        <button
          type="button"
          className="btn btn--sm"
          style={{ alignSelf: 'flex-start' }}
          onClick={() => void requestPermission().then(setState)}
        >
          <Icon name="bell" size={14} />
          Autoriser les notifications
        </button>
      )}
    </div>
  );
}
