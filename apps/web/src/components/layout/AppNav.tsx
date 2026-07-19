import { useAuth } from '../../auth.js';

export function AppNav({ projectName }: { projectName?: string }) {
  const auth = useAuth();

  return (
    <header className="app-nav">
      <a className="app-nav__brand" href="/projects">
        Gaussian Viewer
      </a>
      {projectName ? (
        <div className="app-nav__project">
          <a href="/projects">← Projects</a>
          <span>{projectName}</span>
        </div>
      ) : null}
      <div className="app-nav__account">
        <span>{auth.user?.displayName ?? auth.user?.email ?? 'Signed in'}</span>
        <button className="secondary-button" type="button" onClick={() => void auth.signOut()}>
          Sign out
        </button>
      </div>
    </header>
  );
}
