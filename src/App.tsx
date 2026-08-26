import { useEffect } from 'react';
import { useSession } from '@/store/session';
import { AuthScreen } from '@/features/auth/AuthScreen';
import { Workspace } from '@/features/shell/Workspace';
import { Icon } from '@/components/Icon';

export function App() {
  const session = useSession((state) => state.session);
  const loading = useSession((state) => state.loading);
  const initialize = useSession((state) => state.initialize);

  useEffect(() => initialize(), [initialize]);

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

  return session ? <Workspace /> : <AuthScreen />;
}
