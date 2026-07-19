import type { PropsWithChildren } from 'react';
import { useAuth } from '../../auth.js';

export function ProjectAccess({ children }: PropsWithChildren) {
  const auth = useAuth();
  if (auth.status === 'loading') {
    return <main className="auth-page">Checking your session…</main>;
  }
  if (auth.status !== 'authenticated') {
    return (
      <main className="auth-page">
        <h1>Sign in to open projects.</h1>
        <button className="auth-button" type="button" onClick={() => void auth.signInWithGoogle()}>
          Continue with Google
        </button>
      </main>
    );
  }
  return <>{children}</>;
}
