import { useEffect } from 'react';
import { useSession } from '@/store/session';
import { useRoute, navigate } from '@/lib/router';
import { AuthScreen } from '@/features/auth/AuthScreen';
import { PasswordRecovery } from '@/features/auth/PasswordRecovery';
import { ChooseUsername } from '@/features/auth/ChooseUsername';
import { Landing } from '@/features/landing/Landing';
import { Workspace } from '@/features/shell/Workspace';
import { Icon } from '@/components/Icon';

export function App() {
  const session = useSession((state) => state.session);
  const loading = useSession((state) => state.loading);
  const recovering = useSession((state) => state.recovering);
  const profile = useSession((state) => state.profile);
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
    return <PasswordRecovery />;
  }

  if (session) {
    // Un compte ouvert par un fournisseur tiers arrive avec un pseudo deduit
    // de son adresse. On le fait trancher avant d'entrer : c'est ce par quoi
    // les autres le mentionneront.
    //
    // La colonne peut manquer si la migration n'est pas appliquee : on ne
    // bloque alors personne, `undefined` etant traite comme « deja choisi ».
    if (profile && profile.username_chosen === false) {
      return <ChooseUsername />;
    }

    return (
      <>
        <a className="skip-link" href="#conversation">
          Aller a la conversation
        </a>
        <Workspace />
      </>
    );
  }

  if (route === '/connexion') {
    return <AuthScreen />;
  }

  return <Landing />;
}
