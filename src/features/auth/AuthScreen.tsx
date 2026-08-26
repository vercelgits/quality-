import { useState, type FormEvent } from 'react';
import { useSession } from '@/store/session';
import { Icon } from '@/components/Icon';

type Mode = 'signin' | 'signup' | 'forgot';

const HIGHLIGHTS = [
  {
    icon: 'thread' as const,
    title: 'Des fils qui se referment',
    body: "Chaque question ouvre un fil qui reste en tete de liste jusqu'a ce que quelqu'un le marque comme resolu. Plus rien ne se perd dans le defilement.",
  },
  {
    icon: 'search' as const,
    title: 'Une recherche qui trouve',
    body: 'Classement par pertinence, filtres `de:` et `dans:`, insensible aux accents. Retrouver un message de l’an dernier prend deux secondes.',
  },
  {
    icon: 'sparkles' as const,
    title: 'Leger, et vraiment',
    body: 'Aucun moteur de navigateur embarque, un demarrage instantane, un theme clair qui n’est pas une arriere-pensee et une densite reglable.',
  },
];

export function AuthScreen() {
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const { signIn, signUp, requestPasswordReset, error, clearError } = useSession();

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;

    clearError();
    setNotice(null);
    setBusy(true);

    try {
      if (mode === 'forgot') {
        const sent = await requestPasswordReset(email);
        if (sent) {
          // Le message ne dit pas si l'adresse est connue : l'inverse
          // permettrait d'enumerer les comptes inscrits.
          setNotice(
            'Si un compte existe avec cette adresse, un lien de reinitialisation ' +
              'vient d’y etre envoye. Pensez a regarder vos indesirables.',
          );
        }
      } else if (mode === 'signin') {
        await signIn(email.trim(), password);
      } else {
        await signUp(email.trim(), password, username.trim());
        setNotice(
          'Compte cree. Si la confirmation par e-mail est active sur le projet, ' +
            'validez le lien recu avant de vous connecter.',
        );
        setMode('signin');
      }
    } catch {
      // Le message est deja dans le store, affiche plus bas.
    } finally {
      setBusy(false);
    }
  };

  const switchMode = (next: Mode) => {
    setMode(next);
    clearError();
    setNotice(null);
  };

  const usernameIssue =
    mode === 'signup' && username.length > 0 && !/^[a-zA-Z0-9_.-]{2,32}$/.test(username)
      ? 'Entre 2 et 32 caracteres : lettres, chiffres, point, tiret, souligne.'
      : null;

  const emailLooksValid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());

  const canSubmit =
    mode === 'forgot'
      ? emailLooksValid
      : emailLooksValid &&
        password.length >= 6 &&
        (mode === 'signin' || (username.trim().length >= 2 && usernameIssue === null));

  return (
    <div className="auth">
      <section className="auth__pitch">
        <div className="auth__brand">
          <span className="auth__logo" aria-hidden="true">
            <Icon name="compass" size={22} />
          </span>
          <span className="auth__wordmark">Orbit</span>
        </div>

        <h1 className="auth__headline">
          La discussion d’equipe,
          <br />
          debarrassee du bruit.
        </h1>

        <p className="auth__subhead">
          Tout ce qu’on aime dans Discord, sans ce qui fait renoncer : l’historique
          illisible, la recherche approximative et les trois gigaoctets de memoire.
        </p>

        <ul className="auth__highlights">
          {HIGHLIGHTS.map((item) => (
            <li className="auth__highlight" key={item.title}>
              <span className="auth__highlight-icon" aria-hidden="true">
                <Icon name={item.icon} size={17} />
              </span>
              <div>
                <h2 className="auth__highlight-title">{item.title}</h2>
                <p className="auth__highlight-body">{item.body}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="auth__panel">
        <form className="auth__form" onSubmit={handleSubmit}>
          {mode !== 'forgot' ? (
          <div className="auth__tabs" role="tablist" aria-label="Mode de connexion">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'signin'}
              className={'auth__tab' + (mode === 'signin' ? ' is-active' : '')}
              onClick={() => switchMode('signin')}
            >
              Se connecter
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'signup'}
              className={'auth__tab' + (mode === 'signup' ? ' is-active' : '')}
              onClick={() => switchMode('signup')}
            >
              Creer un compte
            </button>
          </div>
          ) : (
            <div className="stack" style={{ gap: 'var(--space-2)' }}>
              <h1 className="auth__title">Mot de passe oublie</h1>
              <p className="auth__subtitle">
                Indiquez votre adresse : nous vous enverrons un lien pour en choisir
                un nouveau.
              </p>
            </div>
          )}

          <div className="field">
            <label className="field__label" htmlFor="auth-email">
              Adresse e-mail
            </label>
            <input
              id="auth-email"
              className="input"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="vous@exemple.fr"
            />
          </div>

          {mode === 'signup' ? (
            <div className="field">
              <label className="field__label" htmlFor="auth-username">
                Pseudo
              </label>
              <input
                id="auth-username"
                className="input"
                type="text"
                autoComplete="username"
                required
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="camille"
                maxLength={32}
                aria-describedby="auth-username-hint"
              />
              <p className="field__hint" id="auth-username-hint">
                {usernameIssue ?? 'C’est ainsi qu’on vous mentionnera : @camille.'}
              </p>
            </div>
          ) : null}

          {mode !== 'forgot' ? (
          <div className="field">
            <label className="field__label" htmlFor="auth-password">
              Mot de passe
            </label>
            <input
              id="auth-password"
              className="input"
              type="password"
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              required
              minLength={6}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="••••••••"
            />
            {mode === 'signup' ? (
              <p className="field__hint">Six caracteres minimum.</p>
            ) : (
              <button
                type="button"
                className="auth__link"
                onClick={() => switchMode('forgot')}
              >
                Mot de passe oublie ?
              </button>
            )}
          </div>
          ) : null}

          {error ? (
            <p className="auth__error" role="alert">
              {error}
            </p>
          ) : null}

          {notice ? (
            <p className="auth__notice" role="status">
              {notice}
            </p>
          ) : null}

          <button className="btn btn--primary btn--block" type="submit" disabled={!canSubmit || busy}>
            {busy ? <span className="spinner" /> : null}
            {mode === 'forgot'
              ? 'Envoyer le lien'
              : mode === 'signin'
                ? 'Entrer'
                : 'Creer mon espace'}
          </button>

          {mode === 'forgot' ? (
            <button
              type="button"
              className="auth__link auth__link--centered"
              onClick={() => switchMode('signin')}
            >
              Revenir a la connexion
            </button>
          ) : null}

          <p className="auth__legal">
            En continuant, vous acceptez que vos messages soient stockes sur le projet
            Supabase configure pour cette instance.
          </p>
        </form>
      </section>
    </div>
  );
}
