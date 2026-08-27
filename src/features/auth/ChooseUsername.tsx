import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { supabase, errorMessage } from '@/lib/supabase';
import { useSession } from '@/store/session';
import { Icon } from '@/components/Icon';
import { Avatar } from '@/components/Avatar';
import { LIMITS } from '@/constants';
import type { Profile } from '@/types/db';

/**
 * Choix du pseudo, apres une connexion par un fournisseur tiers.
 *
 * Google ne fournit pas de pseudo : la base en deduit un de l'adresse e-mail
 * pour que le compte existe, mais celui-ci est ce par quoi on sera mentionne.
 * Cet ecran s'intercale donc avant l'application, et on n'en sort pas sans
 * avoir tranche.
 */

const PATTERN = /^[a-z0-9_.-]{2,32}$/;

export function ChooseUsername() {
  const profile = useSession((state) => state.profile);
  const setProfile = useSession((state) => state.setProfile);
  const signOut = useSession((state) => state.signOut);

  const [value, setValue] = useState('');
  const [status, setStatus] = useState<'idle' | 'checking' | 'free' | 'taken' | 'invalid'>('idle');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const ticket = useRef(0);

  // Proposition de depart : ce que la base a deduit, que l'on peut garder.
  useEffect(() => {
    if (profile && value === '') setValue(profile.username);
    inputRef.current?.focus();
    // Volontairement limite au montage : reinitialiser a chaque frappe
    // ecraserait la saisie en cours.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id]);

  const check = useCallback(async (candidate: string) => {
    const normalised = candidate.trim().toLowerCase();

    if (!PATTERN.test(normalised)) {
      setStatus(normalised.length === 0 ? 'idle' : 'invalid');
      return;
    }

    const mine = ++ticket.current;
    setStatus('checking');

    const { data } = await supabase.rpc('username_available', { p_username: normalised });

    // Une reponse plus lente d'une frappe precedente ne doit pas ecraser un
    // resultat plus recent.
    if (mine !== ticket.current) return;
    setStatus(data === true ? 'free' : 'taken');
  }, []);

  // Verification differee : une requete par caractere serait du gaspillage.
  useEffect(() => {
    const timer = window.setTimeout(() => void check(value), 350);
    return () => window.clearTimeout(timer);
  }, [value, check]);

  if (!profile) return null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (status !== 'free' || busy) return;

    setBusy(true);
    setError(null);

    const { data, error: failure } = await supabase.rpc('claim_username', {
      p_username: value.trim().toLowerCase(),
    });

    setBusy(false);

    if (failure) {
      setError(errorMessage(failure));
      setStatus('taken');
      return;
    }

    setProfile(data as Profile);
  };

  return (
    <div className="onboarding">
      <form className="onboarding__card" onSubmit={submit}>
        <div className="onboarding__avatar">
          <Avatar profile={profile} size={72} />
        </div>

        <h1 className="onboarding__title">Choisissez votre pseudo</h1>
        <p className="onboarding__lede">
          C’est ainsi qu’on vous mentionnera dans les conversations. Vous pouvez
          garder celui proposé ou en prendre un autre.
        </p>

        <div className="field onboarding__field">
          <label className="field__label" htmlFor="onboarding-username">
            Pseudo
          </label>

          <div className="onboarding__input">
            <span className="onboarding__at" aria-hidden="true">
              @
            </span>
            <input
              ref={inputRef}
              id="onboarding-username"
              className="input"
              value={value}
              maxLength={LIMITS.usernameLength}
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              aria-describedby="onboarding-status"
              aria-invalid={status === 'taken' || status === 'invalid'}
              onChange={(event) => setValue(event.target.value.toLowerCase())}
            />
            <span className="onboarding__state" aria-hidden="true">
              {status === 'checking' ? <span className="spinner" /> : null}
              {status === 'free' ? <Icon name="check" size={17} /> : null}
              {status === 'taken' || status === 'invalid' ? <Icon name="x" size={17} /> : null}
            </span>
          </div>

          <p
            className={
              status === 'taken' || status === 'invalid' ? 'field__error' : 'field__hint'
            }
            id="onboarding-status"
            aria-live="polite"
          >
            {status === 'invalid'
              ? 'Entre 2 et 32 caractères : lettres, chiffres, point, tiret, souligné.'
              : status === 'taken'
                ? 'Ce pseudo est déjà pris. Essayez-en un autre.'
                : status === 'free'
                  ? 'Ce pseudo est libre.'
                  : status === 'checking'
                    ? 'Vérification…'
                    : 'Minuscules, sans espace.'}
          </p>
        </div>

        {error ? (
          <p className="auth__error" role="alert">
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          className="btn btn--primary btn--lg btn--block"
          disabled={status !== 'free' || busy}
        >
          {busy ? <span className="spinner" /> : null}
          Continuer
        </button>

        <button
          type="button"
          className="btn btn--link btn--block"
          onClick={() => void signOut()}
        >
          Me déconnecter
        </button>
      </form>
    </div>
  );
}
