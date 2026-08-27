import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useSession, type AccentName, type Density, type Theme } from '@/store/session';
import { useUI, type SettingsSection } from '@/store/ui';
import { useFriends } from '@/store/friends';
import { supabase } from '@/lib/supabase';
import { Icon, type IconName } from '@/components/Icon';
import { Avatar } from '@/components/Avatar';
import { LIMITS } from '@/constants';
import { VoiceSettings, SwitchRow } from './VoiceSettings';
import {
  permissionState,
  requestPermission,
  isDesktop,
  type NotificationPermissionState,
} from '@/lib/notify';

/**
 * Parametres en pleine page.
 *
 * Une page qui recouvre l'application, comme dans les clients de messagerie :
 * il y a trop de reglages pour une fenetre, et certains — test de micro,
 * apercu de camera — demandent de la place. On en sort par Echap ou par la
 * croix, jamais en cliquant a cote : un clic malheureux ne doit pas faire
 * perdre une saisie en cours.
 */

const SECTIONS: { value: SettingsSection; label: string; icon: IconName }[] = [
  { value: 'compte', label: 'Mon compte', icon: 'key' },
  { value: 'profil', label: 'Profil', icon: 'smile' },
  { value: 'confidentialite', label: 'Confidentialite', icon: 'shield' },
  { value: 'voix', label: 'Voix et video', icon: 'mic' },
  { value: 'apparence', label: 'Apparence', icon: 'moon' },
  { value: 'notifications', label: 'Notifications', icon: 'bell' },
  { value: 'raccourcis', label: 'Raccourcis', icon: 'keyboard' },
  { value: 'avance', label: 'Avance', icon: 'sliders' },
];

export function SettingsPage() {
  const section = useUI((state) => state.settings);
  const openSettings = useUI((state) => state.openSettings);
  const closeSettings = useUI((state) => state.closeSettings);
  const signOut = useSession((state) => state.signOut);
  const activeRef = useRef<HTMLButtonElement>(null);

  // Sur petit ecran la navigation devient un bandeau horizontal, plus large que
  // l'ecran : sans cela, la section ouverte reste hors champ et on ne sait pas
  // ou l'on se trouve.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [section]);

  useEffect(() => {
    if (!section) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;

      // Une liste deroulante ouverte consomme Echap pour se refermer : fermer
      // la page en meme temps serait deroutant.
      const target = event.target as HTMLElement | null;
      if (target?.tagName === 'SELECT') return;

      event.preventDefault();
      closeSettings();
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [section, closeSettings]);

  if (!section) return null;

  return (
    <div className="settings" role="dialog" aria-modal="true" aria-label="Parametres">
      <nav className="settings__nav" aria-label="Sections des parametres">
        <div className="settings__nav-inner">
          <p className="settings__nav-title">Parametres</p>

          {SECTIONS.map((entry) => (
            <button
              key={entry.value}
              ref={section === entry.value ? activeRef : undefined}
              type="button"
              className={'settings__navitem' + (section === entry.value ? ' is-active' : '')}
              aria-current={section === entry.value ? 'page' : undefined}
              onClick={() => openSettings(entry.value)}
            >
              <Icon name={entry.icon} size={16} />
              {entry.label}
            </button>
          ))}

          <hr className="settings__nav-rule" />

          <button
            type="button"
            className="settings__navitem settings__navitem--danger"
            onClick={() => void signOut()}
          >
            <Icon name="log-out" size={16} />
            Se deconnecter
          </button>
        </div>
      </nav>

      <div className="settings__main">
        <div className="settings__scroll">
          {section === 'compte' ? <AccountSection /> : null}
          {section === 'profil' ? <ProfileSection /> : null}
          {section === 'confidentialite' ? <PrivacySection /> : null}
          {section === 'voix' ? <VoiceSettings /> : null}
          {section === 'apparence' ? <AppearanceSection /> : null}
          {section === 'notifications' ? <NotificationsSection /> : null}
          {section === 'raccourcis' ? <ShortcutsSection /> : null}
          {section === 'avance' ? <AdvancedSection /> : null}
        </div>

        <button
          type="button"
          className="settings__close"
          onClick={closeSettings}
          aria-label="Fermer les parametres"
        >
          <Icon name="x" size={18} />
          <span className="settings__close-key">ECHAP</span>
        </button>
      </div>
    </div>
  );
}

/* ========================================================================== */
/* Mon compte                                                                 */
/* ========================================================================== */

function AccountSection() {
  const session = useSession((state) => state.session);
  const profile = useSession((state) => state.profile);
  const updatePassword = useSession((state) => state.updatePassword);

  const email = session?.user.email ?? null;

  // Un compte ouvert par Google n'a pas de mot de passe a changer ici : le
  // proposer conduirait a un formulaire qui echoue ou qui cree une seconde
  // methode de connexion sans l'annoncer.
  const providers = useMemo(() => {
    const identities = session?.user.identities ?? [];
    return identities.map((identity) => identity.provider);
  }, [session]);

  const hasPassword = providers.includes('email') || providers.length === 0;

  return (
    <div className="settings__page">
      <h1 className="settings__title">Mon compte</h1>

      {profile ? (
        <div className="account">
          <div className="account__banner" style={{ background: profile.accent }} />
          <div className="account__head">
            <Avatar profile={profile} size={80} showStatus />
            <div className="account__identity">
              <span className="account__name">{profile.display_name}</span>
              <span className="account__handle">@{profile.username}</span>
            </div>
          </div>

          <dl className="account__facts">
            <Fact label="Adresse e-mail" value={email ?? 'Inconnue'} icon="mail" />
            <Fact label="Pseudo" value={`@${profile.username}`} icon="at" />
            <Fact
              label="Connexion"
              icon="key"
              value={
                providers.length === 0
                  ? 'Mot de passe'
                  : providers.map(providerLabel).join(', ')
              }
            />
            <Fact
              label="Membre depuis"
              icon="sparkles"
              value={new Date(profile.created_at).toLocaleDateString('fr-FR', {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}
            />
          </dl>
        </div>
      ) : null}

      <section className="settings__group">
        <h2 className="settings__group-title">Mot de passe</h2>

        {hasPassword ? (
          <PasswordForm onSubmit={updatePassword} />
        ) : (
          <p className="settings__hint">
            Vous vous connectez avec {providers.map(providerLabel).join(' et ')}.
            Le mot de passe se change chez ce fournisseur, pas ici.
          </p>
        )}
      </section>

      <section className="settings__group settings__group--danger">
        <h2 className="settings__group-title">Suppression du compte</h2>
        <p className="settings__hint">
          La suppression definitive n’est pas encore branchee : elle demande
          d’effacer aussi vos messages chez les autres, ce qui ne peut pas se
          faire depuis le navigateur seul. Ecrivez-nous en attendant plutot que
          de croire un bouton qui ne ferait rien.
        </p>
      </section>
    </div>
  );
}

function providerLabel(provider: string): string {
  if (provider === 'google') return 'Google';
  if (provider === 'email') return 'Mot de passe';
  return provider;
}

function Fact({ label, value, icon }: { label: string; value: string; icon: IconName }) {
  return (
    <div className="account__fact">
      <dt>
        <Icon name={icon} size={14} />
        {label}
      </dt>
      <dd>{value}</dd>
    </div>
  );
}

/**
 * Changement de mot de passe.
 *
 * La confirmation est comparee dans le formulaire : Supabase accepterait une
 * faute de frappe sans broncher, et on se retrouverait enferme dehors au
 * prochain retour.
 */
function PasswordForm({ onSubmit }: { onSubmit: (password: string) => Promise<boolean> }) {
  const [value, setValue] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const tooShort = value.length > 0 && value.length < LIMITS.passwordLength;
  const mismatch = confirmation.length > 0 && confirmation !== value;
  const ready = value.length >= LIMITS.passwordLength && confirmation === value;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!ready || busy) return;

    setBusy(true);
    const changed = await onSubmit(value);
    setBusy(false);

    if (changed) {
      setValue('');
      setConfirmation('');
      setDone(true);
      window.setTimeout(() => setDone(false), 4000);
    }
  };

  return (
    <form className="settings__form" onSubmit={(event) => void submit(event)}>
      <div className="settings__field">
        <label className="settings__label" htmlFor="set-password">
          Nouveau mot de passe
        </label>
        <input
          id="set-password"
          type="password"
          className="settings__input"
          value={value}
          autoComplete="new-password"
          onChange={(event) => setValue(event.target.value)}
        />
        {tooShort ? (
          <p className="settings__error">
            Au moins {LIMITS.passwordLength} caracteres.
          </p>
        ) : null}
      </div>

      <div className="settings__field">
        <label className="settings__label" htmlFor="set-password-2">
          Confirmation
        </label>
        <input
          id="set-password-2"
          type="password"
          className="settings__input"
          value={confirmation}
          autoComplete="new-password"
          onChange={(event) => setConfirmation(event.target.value)}
        />
        {mismatch ? <p className="settings__error">Les deux saisies different.</p> : null}
      </div>

      <div className="settings__row">
        <button type="submit" className="btn btn--primary" disabled={!ready || busy}>
          {busy ? <span className="spinner" /> : null}
          Changer le mot de passe
        </button>
        {done ? (
          <span className="settings__ok" role="status">
            <Icon name="check" size={14} />
            Mot de passe mis a jour
          </span>
        ) : null}
      </div>
    </form>
  );
}

/* ========================================================================== */
/* Profil                                                                     */
/* ========================================================================== */

function ProfileSection() {
  const profile = useSession((state) => state.profile);
  const updateProfile = useSession((state) => state.updateProfile);
  const setStatus = useSession((state) => state.setStatus);
  const openModal = useUI((state) => state.openModal);

  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [pronouns, setPronouns] = useState('');
  const [customStatus, setCustomStatus] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!profile) return;
    setDisplayName(profile.display_name);
    setBio(profile.bio ?? '');
    setPronouns(profile.pronouns ?? '');
    setCustomStatus(profile.custom_status ?? '');
  }, [profile]);

  if (!profile) return null;

  const dirty =
    displayName !== profile.display_name ||
    bio !== (profile.bio ?? '') ||
    pronouns !== (profile.pronouns ?? '') ||
    customStatus !== (profile.custom_status ?? '');

  const save = async () => {
    setBusy(true);
    await updateProfile({
      display_name: displayName.trim(),
      bio: bio.trim() || null,
      pronouns: pronouns.trim() || null,
    });
    await setStatus(profile.status, customStatus.trim() || null);
    setBusy(false);
  };

  return (
    <div className="settings__page">
      <h1 className="settings__title">Profil</h1>

      <section className="settings__group">
        <div className="settings__field">
          <label className="settings__label" htmlFor="set-name">
            Nom affiche
          </label>
          <input
            id="set-name"
            className="settings__input"
            value={displayName}
            maxLength={LIMITS.displayNameLength}
            onChange={(event) => setDisplayName(event.target.value)}
          />
        </div>

        <div className="settings__field">
          <label className="settings__label" htmlFor="set-pronouns">
            Pronoms
          </label>
          <input
            id="set-pronouns"
            className="settings__input"
            value={pronouns}
            maxLength={32}
            placeholder="iel, elle, il…"
            onChange={(event) => setPronouns(event.target.value)}
          />
        </div>

        <div className="settings__field">
          <label className="settings__label" htmlFor="set-status">
            Statut personnalise
          </label>
          <input
            id="set-status"
            className="settings__input"
            value={customStatus}
            maxLength={LIMITS.customStatusLength}
            placeholder="En reunion jusqu’a 15 h"
            onChange={(event) => setCustomStatus(event.target.value)}
          />
        </div>

        <div className="settings__field">
          <label className="settings__label" htmlFor="set-bio">
            A propos
          </label>
          <textarea
            id="set-bio"
            className="settings__input settings__input--area"
            rows={4}
            value={bio}
            maxLength={280}
            onChange={(event) => setBio(event.target.value)}
          />
          <p className="settings__hint">{280 - bio.length} caracteres restants.</p>
        </div>

        <div className="settings__row">
          <button
            type="button"
            className="btn btn--primary"
            disabled={!dirty || busy}
            onClick={() => void save()}
          >
            {busy ? <span className="spinner" /> : null}
            Enregistrer
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => openModal({ kind: 'edit-profile' })}
          >
            <Icon name="edit" size={14} />
            Avatar, banniere et liens
          </button>
        </div>
      </section>
    </div>
  );
}

/* ========================================================================== */
/* Confidentialite                                                            */
/* ========================================================================== */

function PrivacySection() {
  const blocked = useFriends((state) => state.blocked);
  const profiles = useFriends((state) => state.profiles);
  const unblock = useFriends((state) => state.unblock);
  const load = useFriends((state) => state.load);
  const showFriends = useUI((state) => state.showFriends);
  const closeSettings = useUI((state) => state.closeSettings);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="settings__page">
      <h1 className="settings__title">Confidentialite</h1>

      <section className="settings__group">
        <h2 className="settings__group-title">Qui peut vous ecrire</h2>
        <p className="settings__hint">
          Les messages prives sont ouverts a vos amis et aux personnes avec qui
          vous partagez un espace. Cette regle est appliquee par la base de
          donnees, pas par l’interface : elle tient meme si quelqu’un contourne
          l’application.
        </p>
      </section>

      <section className="settings__group">
        <h2 className="settings__group-title">
          Personnes bloquees {blocked.length > 0 ? `— ${blocked.length}` : ''}
        </h2>

        {blocked.length === 0 ? (
          <p className="settings__hint">
            Vous n’avez bloque personne. Un blocage empeche les messages prives
            dans les deux sens, et la personne n’en est pas informee.
          </p>
        ) : (
          <ul className="settings__people">
            {blocked.map((link) => {
              const person = profiles[link.user_id];
              if (!person) return null;
              return (
                <li key={link.id} className="settings__person">
                  <Avatar profile={person} size={32} />
                  <span className="settings__person-name">
                    {person.display_name}
                    <span className="settings__person-handle">@{person.username}</span>
                  </span>
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => void unblock(person.id)}
                  >
                    Debloquer
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <button
          type="button"
          className="btn btn--ghost btn--sm settings__inline-btn"
          onClick={() => {
            closeSettings();
            showFriends();
          }}
        >
          <Icon name="users" size={14} />
          Ouvrir la page des amis
        </button>
      </section>

      <section className="settings__group">
        <h2 className="settings__group-title">Donnees</h2>
        <p className="settings__hint">
          Vos messages sont conserves tant que vous ne les supprimez pas.
          L’application ne vous suit pas et n’envoie rien a des tiers : elle ne
          parle qu’a votre base Supabase.
        </p>
      </section>
    </div>
  );
}

/* ========================================================================== */
/* Apparence                                                                  */
/* ========================================================================== */

const THEMES: { value: Theme; label: string; icon: IconName }[] = [
  { value: 'light', label: 'Clair', icon: 'sun' },
  { value: 'dark', label: 'Sombre', icon: 'moon' },
  { value: 'system', label: 'Systeme', icon: 'monitor' },
];

const DENSITIES: { value: Density; label: string; hint: string }[] = [
  { value: 'compact', label: 'Compact', hint: 'Plus de messages a l’ecran.' },
  { value: 'cozy', label: 'Confortable', hint: 'L’equilibre par defaut.' },
  { value: 'spacious', label: 'Aere', hint: 'Plus de respiration entre les messages.' },
];

const ACCENTS: { value: AccentName; label: string }[] = [
  { value: 'indigo', label: 'Indigo' },
  { value: 'violet', label: 'Violet' },
  { value: 'ocean', label: 'Ocean' },
  { value: 'teal', label: 'Turquoise' },
  { value: 'forest', label: 'Foret' },
  { value: 'sunset', label: 'Couchant' },
  { value: 'rose', label: 'Rose' },
  { value: 'mono', label: 'Neutre' },
];

function AppearanceSection() {
  const preferences = useSession((state) => state.preferences);
  const setPreference = useSession((state) => state.setPreference);

  return (
    <div className="settings__page">
      <h1 className="settings__title">Apparence</h1>

      <section className="settings__group">
        <h2 className="settings__group-title">Theme</h2>
        <div className="settings__segmented settings__segmented--wide">
          {THEMES.map((option) => (
            <button
              key={option.value}
              type="button"
              className={
                'settings__seg' + (preferences.theme === option.value ? ' is-active' : '')
              }
              aria-pressed={preferences.theme === option.value}
              onClick={() => setPreference('theme', option.value)}
            >
              <Icon name={option.icon} size={15} />
              {option.label}
            </button>
          ))}
        </div>
      </section>

      <section className="settings__group">
        <h2 className="settings__group-title">Couleur de l’interface</h2>
        <div className="settings__hues">
          {ACCENTS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={
                'settings__hue' + (preferences.accent === option.value ? ' is-active' : '')
              }
              data-accent-swatch={option.value}
              title={option.label}
              aria-label={option.label}
              aria-pressed={preferences.accent === option.value}
              onClick={() => setPreference('accent', option.value)}
            />
          ))}
        </div>
        <p className="settings__hint">
          Une seule teinte de base, dont tout le reste derive : les contrastes
          restent corrects quel que soit votre choix.
        </p>
      </section>

      <section className="settings__group">
        <h2 className="settings__group-title">Densite d’affichage</h2>
        <div className="settings__cards">
          {DENSITIES.map((option) => (
            <button
              key={option.value}
              type="button"
              className={
                'settings__card' + (preferences.density === option.value ? ' is-active' : '')
              }
              aria-pressed={preferences.density === option.value}
              onClick={() => setPreference('density', option.value)}
            >
              <span className="settings__card-label">{option.label}</span>
              <span className="settings__card-hint">{option.hint}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="settings__group">
        <h2 className="settings__group-title">Messages</h2>

        <SwitchRow
          label="Heure sur chaque message"
          hint="Affiche l’heure meme sur les messages regroupes."
          checked={preferences.showTimestamps}
          onChange={(value) => setPreference('showTimestamps', value)}
        />
        <SwitchRow
          label="Envoyer avec Entree"
          hint="Sinon, Entree insere un retour a la ligne et Ctrl+Entree envoie."
          checked={preferences.sendOnEnter}
          onChange={(value) => setPreference('sendOnEnter', value)}
        />
        <SwitchRow
          label="Reduire les animations"
          hint="Coupe les transitions, au-dela du reglage du systeme."
          checked={preferences.reduceMotion}
          onChange={(value) => setPreference('reduceMotion', value)}
        />
      </section>
    </div>
  );
}

/* ========================================================================== */
/* Notifications                                                              */
/* ========================================================================== */

function NotificationsSection() {
  const [state, setState] = useState<NotificationPermissionState>('default');

  useEffect(() => {
    void permissionState().then(setState);
  }, []);

  return (
    <div className="settings__page">
      <h1 className="settings__title">Notifications</h1>

      <section className="settings__group">
        <h2 className="settings__group-title">Bulles du systeme</h2>

        {state === 'unsupported' ? (
          <p className="settings__hint">Ce navigateur ne gere pas les notifications.</p>
        ) : (
          <>
            <p className="settings__hint">
              Une bulle apparait uniquement quand on vous mentionne et que la
              fenetre n’est pas au premier plan.
              {isDesktop() ? ' Elle passe par le centre de notifications du systeme.' : ''}
            </p>

            {state === 'granted' ? (
              <p className="settings__ok" role="status">
                <Icon name="check" size={14} />
                Notifications autorisees
              </p>
            ) : state === 'denied' ? (
              <p className="settings__alert">
                Notifications bloquees. Reautorisez-les depuis les reglages du
                site dans votre navigateur : une page web ne peut pas revenir
                sur un refus toute seule.
              </p>
            ) : (
              <button
                type="button"
                className="btn btn--primary btn--sm settings__inline-btn"
                onClick={() => void requestPermission().then(setState)}
              >
                <Icon name="bell" size={14} />
                Autoriser les notifications
              </button>
            )}
          </>
        )}
      </section>

      <section className="settings__group">
        <h2 className="settings__group-title">Ce qui declenche une alerte</h2>
        <p className="settings__hint">
          Les mentions directes, @tous, et les messages prives. Le reste
          n’allume qu’une pastille dans la liste des salons, pour ne pas
          transformer chaque conversation en interruption.
        </p>
      </section>
    </div>
  );
}

/* ========================================================================== */
/* Raccourcis                                                                 */
/* ========================================================================== */

const SHORTCUTS: { keys: string[]; label: string }[] = [
  { keys: ['Ctrl', 'K'], label: 'Ouvrir la palette de commandes' },
  { keys: ['Ctrl', 'F'], label: 'Rechercher dans les messages' },
  { keys: ['Ctrl', ','], label: 'Ouvrir les parametres' },
  { keys: ['Echap'], label: 'Fermer le panneau ou la fenetre en cours' },
  { keys: ['Entree'], label: 'Envoyer le message' },
  { keys: ['Maj', 'Entree'], label: 'Retour a la ligne' },
  { keys: ['Haut'], label: 'Modifier son dernier message' },
];

function ShortcutsSection() {
  return (
    <div className="settings__page">
      <h1 className="settings__title">Raccourcis</h1>

      <section className="settings__group">
        <ul className="shortcuts">
          {SHORTCUTS.map((entry) => (
            <li key={entry.label} className="shortcuts__row">
              <span className="shortcuts__label">{entry.label}</span>
              <span className="shortcuts__keys">
                {entry.keys.map((key) => (
                  <kbd key={key} className="shortcuts__key">
                    {key}
                  </kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

/* ========================================================================== */
/* Avance                                                                     */
/* ========================================================================== */

function AdvancedSection() {
  const [checking, setChecking] = useState(false);
  const [health, setHealth] = useState<'ok' | 'down' | null>(null);
  const [latency, setLatency] = useState<number | null>(null);

  /**
   * Un aller-retour reel vers la base plutot qu'un indicateur decoratif :
   * quand quelque chose ne marche pas, la premiere question est de savoir si
   * la connexion tient.
   */
  const test = async () => {
    setChecking(true);
    const started = performance.now();

    const { error } = await supabase.from('profiles').select('id').limit(1);

    setLatency(Math.round(performance.now() - started));
    setHealth(error ? 'down' : 'ok');
    setChecking(false);
  };

  return (
    <div className="settings__page">
      <h1 className="settings__title">Avance</h1>

      <section className="settings__group">
        <h2 className="settings__group-title">Langue</h2>
        <p className="settings__hint">
          L’application est en francais. La recherche utilise l’analyseur
          francais de Postgres, qui ignore les accents et les mots vides.
          D’autres langues demanderaient une traduction complete plutot qu’un
          menu qui ne changerait rien.
        </p>
      </section>

      <section className="settings__group">
        <h2 className="settings__group-title">Connexion</h2>

        <div className="settings__row">
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            disabled={checking}
            onClick={() => void test()}
          >
            {checking ? <span className="spinner" /> : <Icon name="refresh" size={14} />}
            Tester la connexion
          </button>

          {health === 'ok' ? (
            <span className="settings__ok" role="status">
              <Icon name="check" size={14} />
              Base joignable en {latency} ms
            </span>
          ) : health === 'down' ? (
            <span className="settings__alert" role="alert">
              Base injoignable.
            </span>
          ) : null}
        </div>
      </section>

      <section className="settings__group">
        <h2 className="settings__group-title">A propos</h2>
        <dl className="account__facts">
          <Fact label="Version" value={__APP_VERSION__} icon="sparkles" />
          <Fact
            label="Environnement"
            value={isDesktop() ? 'Application de bureau' : 'Navigateur'}
            icon="monitor"
          />
        </dl>
      </section>
    </div>
  );
}
