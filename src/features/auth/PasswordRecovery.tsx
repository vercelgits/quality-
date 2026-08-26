import { useState, type FormEvent } from 'react';
import { useSession } from '@/store/session';
import { Icon } from '@/components/Icon';

/**
 * Choix d'un nouveau mot de passe apres un retour depuis le courriel.
 *
 * Supabase ouvre deja une session valide a ce moment-la : l'ecran s'intercale
 * donc devant l'application, sinon on entrerait sans jamais avoir choisi le
 * nouveau mot de passe et le lien resterait actif.
 */
export function PasswordRecovery() {
  const updatePassword = useSession((state) => state.updatePassword);
  const endRecovery = useSession((state) => state.endRecovery);
  const signOut = useSession((state) => state.signOut);
  const error = useSession((state) => state.error);

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  const tooShort = password.length > 0 && password.length < 8;
  const mismatch = confirm.length > 0 && confirm !== password;
  const canSubmit = password.length >= 8 && confirm === password && !busy;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;

    setBusy(true);
    const ok = await updatePassword(password);
    setBusy(false);

    if (ok) endRecovery();
  };

  return (
    <div className="auth auth--single">
      <section className="auth__panel">
        <form className="auth__form" onSubmit={submit}>
          <div className="auth__brand auth__brand--centered">
            <span className="auth__logo" aria-hidden="true">
              <Icon name="compass" size={22} />
            </span>
            <span className="auth__wordmark">Orbit</span>
          </div>

          <div className="stack" style={{ gap: 'var(--space-2)' }}>
            <h1 className="auth__title">Choisissez un nouveau mot de passe</h1>
            <p className="auth__subtitle">
              Votre lien est valide. Une fois le mot de passe enregistre, il cessera
              de fonctionner.
            </p>
          </div>

          <div className="field">
            <label className="field__label" htmlFor="pr-password">
              Nouveau mot de passe
            </label>
            <input
              id="pr-password"
              className="input"
              type="password"
              autoComplete="new-password"
              autoFocus
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              aria-describedby="pr-password-hint"
              aria-invalid={tooShort}
            />
            <p className="field__hint" id="pr-password-hint">
              Huit caracteres minimum.
            </p>
          </div>

          <div className="field">
            <label className="field__label" htmlFor="pr-confirm">
              Repetez-le
            </label>
            <input
              id="pr-confirm"
              className="input"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              aria-invalid={mismatch}
            />
            {mismatch ? (
              <p className="field__error">
                <Icon name="x" size={13} />
                Les deux mots de passe different.
              </p>
            ) : null}
          </div>

          {error ? (
            <p className="auth__error" role="alert">
              {error}
            </p>
          ) : null}

          <button className="btn btn--primary btn--block btn--lg" type="submit" disabled={!canSubmit}>
            {busy ? <span className="spinner" /> : <Icon name="check" size={16} />}
            Enregistrer et continuer
          </button>

          <button
            type="button"
            className="btn btn--ghost btn--block"
            onClick={() => void signOut()}
          >
            Annuler et me deconnecter
          </button>
        </form>
      </section>
    </div>
  );
}
