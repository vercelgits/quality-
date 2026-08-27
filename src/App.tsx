import { useEffect } from 'react';
import { useSession } from '@/store/session';
import { useRoute, navigate } from '@/lib/router';
import { AuthScreen } from '@/features/auth/AuthScreen';
import { PasswordRecovery } from '@/features/auth/PasswordRecovery';
import { Landing } from '@/features/landing/Landing';
import { Workspace } from '@/features/shell/Workspace';
import { Icon } from '@/components/Icon';
import { Ambient } from '@/components/Ambient';

export function App() {
  const session = useSession((state) => state.session);
  const loading = useSession((state) => state.loading);
  const recovering = useSession((state) => state.recovering);
  const initialize = useSession((state) => state.initialize);

  const { route } = useRoute();

  useEffect(() => initialize(), [initialize]);

  /**
   * Redirections.
   *
   * Elles vivent dans un effet et non dans le rendu : appeler `navigate`
   * pendant un rendu modifierait l'historique au milieu d'une passe de React,
   * ce qui declencherait un second rendu immediat et, ici, une boucle.
   */
  useEffect(() => {
    if (loading || recovering) return;

    // Une session ouverte n'a rien a faire sur la presentation ou la connexion.
    if (session && route !== '/app') {
      navigate('/app', { replace: true });
      return;
    }

    // Sans session, l'application renvoie vers la connexion plutot que vers un
    // ecran vide.
    if (!session && route === '/app') {
      navigate('/connexion', { replace: true });
    }
  }, [session, route, loading, recovering]);

  if (loading) {
    return (
      <div className="boot">
        <Ambient />
        <span className="boot__mark">
          <Icon name="compass" size={26} />
        </span>
        <span className="spinner" />
      </div>
    );
  }

  // Le retour depuis un lien de recuperation passe avant tout le reste : une
  // session est deja ouverte, mais le mot de passe n'a pas encore ete choisi.
  if (recovering) {
    return (
      <>
        <Ambient />
        <PasswordRecovery />
      </>
    );
  }

  if (session) {
    return (
      <>
        <Ambient />
        <a className="skip-link" href="#conversation">
          Aller a la conversation
        </a>
        <Workspace />
      </>
    );
  }

  if (route === '/connexion') {
    return (
      <>
        <Ambient />
        <AuthScreen />
      </>
    );
  }

  // La presentation a son propre fond : le decor anime la surchargerait.
  return <Landing />;
}
