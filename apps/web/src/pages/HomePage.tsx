import { useAuth } from '../auth.js';
import { ProjectsDashboardPage } from './ProjectsDashboardPage.js';

export function HomePage() {
  const auth = useAuth();

  if (auth.status === 'loading') {
    return <main className="auth-page">Checking your session…</main>;
  }

  if (auth.status === 'authenticated') {
    return <ProjectsDashboardPage />;
  }

  return (
    <main className="auth-page">
      <p className="eyebrow">Gaussian Viewer</p>
      <h1>Sign in to your projects.</h1>
      <p>Upload, align and present your environments and building models from one workspace.</p>
      {auth.error ? <p className="project-error">{auth.error}</p> : null}
      <button className="auth-button" type="button" onClick={() => void auth.signInWithGoogle()}>
        Continue with Google
      </button>
    </main>
  );
}
