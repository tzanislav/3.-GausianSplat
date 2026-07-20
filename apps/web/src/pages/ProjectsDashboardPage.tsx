import type { FormEvent } from 'react';
import { useEffect, useState } from 'react';
import type { ProjectSummary } from '@gaussian-viewer/contracts';
import { useAuth } from '../auth.js';
import { AppNav } from '../components/layout/AppNav.js';
import { formatAssetStatus, formatDate, formatShareStatus, messageFor } from '../lib/format.js';

export function ProjectsDashboardPage() {
  const auth = useAuth();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newProjectName, setNewProjectName] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    if (auth.status !== 'authenticated') {
      setIsLoading(false);
      return;
    }
    void loadProjects();

    async function loadProjects() {
      try {
        setIsLoading(true);
        setError(null);
        const response = await auth.authenticatedFetch('/api/projects');
        if (!response.ok) throw new Error('Projects could not be loaded.');
        setProjects((await response.json()) as ProjectSummary[]);
      } catch (loadError) {
        setError(messageFor(loadError));
      } finally {
        setIsLoading(false);
      }
    }
  }, [auth]);

  async function createProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      setError(null);
      const response = await auth.authenticatedFetch('/api/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: newProjectName }),
      });
      if (!response.ok)
        throw new Error((await response.json()).error ?? 'Project could not be created.');
      const project = (await response.json()) as ProjectSummary;
      setProjects((current) => [project, ...current]);
      setNewProjectName('');
      setIsCreating(false);
    } catch (createError) {
      setError(messageFor(createError));
    }
  }

  async function deleteProject(project: ProjectSummary) {
    if (!window.confirm(`Delete “${project.name}”? This cannot be undone.`)) return;
    try {
      const response = await auth.authenticatedFetch(`/api/projects/${project.id}`, {
        method: 'DELETE',
      });
      if (!response.ok) throw new Error('Project could not be deleted.');
      setProjects((current) => current.filter((item) => item.id !== project.id));
    } catch (deleteError) {
      setError(messageFor(deleteError));
    }
  }

  if (auth.status === 'loading') return <main className="auth-page">Checking your session…</main>;
  if (auth.status !== 'authenticated')
    return (
      <main className="auth-page">
        <p className="eyebrow">Owner area</p>
        <h1>Sign in to view projects.</h1>
        <p>{auth.error ?? 'Project access requires a Firebase account.'}</p>
        <button className="auth-button" type="button" onClick={() => void auth.signInWithGoogle()}>
          Continue with Google
        </button>
        <a href="/">Return to local viewer</a>
      </main>
    );

  return (
    <main className="projects-page">
      <AppNav />
      <header className="projects-page__header">
        <div>
          <h1>Projects</h1>
        </div>
        <div className="auth-page__actions">
          <button className="auth-button" type="button" onClick={() => setIsCreating(true)}>
            New project
          </button>
        </div>
      </header>
      {error ? <p className="project-error">{error}</p> : null}
      {isLoading ? <p className="project-empty">Loading projects…</p> : null}
      {!isLoading && projects.length === 0 ? (
        <section className="project-empty">
          <h2>No projects yet</h2>
          <p>Create a project to prepare a persistent editor workspace.</p>
        </section>
      ) : null}
      <section className="project-grid" aria-label="Your projects">
        {projects.map((project) => (
          <article className="project-card" key={project.id}>
            <div className="project-card__cover">
              {project.coverUrl ? (
                <img src={project.coverUrl} alt={`${project.name} thumbnail`} />
              ) : (
                'No cover'
              )}
            </div>
            <div className="project-card__body">
              <h2>{project.name}</h2>
              <p>Modified {formatDate(project.updatedAt)}</p>
              <ul className="project-card__assets" aria-label="Project files">
                {project.assets.length ? (
                  project.assets.map((asset) => (
                    <li key={asset.id}>
                      {asset.filename}{' '}
                      <span>{asset.kind === 'ENVIRONMENT' ? 'Environment' : 'Building'}</span>
                    </li>
                  ))
                ) : (
                  <li>No uploaded files</li>
                )}
              </ul>
              <div className="project-card__badges">
                <span>{formatAssetStatus(project.assetStatus)}</span>
                <span>{formatShareStatus(project.shareStatus)}</span>
              </div>
              <div className="project-card__actions">
                <a className="auth-button" href={`/projects/${project.id}/editor`}>
                  Open editor
                </a>
                <button type="button" onClick={() => void deleteProject(project)}>
                  Delete
                </button>
              </div>
            </div>
          </article>
        ))}
      </section>
      {isCreating ? (
        <div className="project-dialog-backdrop" role="presentation">
          <form className="project-dialog" onSubmit={(event) => void createProject(event)}>
            <h2>Create project</h2>
            <label>
              Project name
              <input
                autoFocus
                maxLength={120}
                required
                value={newProjectName}
                onChange={(event) => setNewProjectName(event.target.value)}
              />
            </label>
            <div className="auth-page__actions">
              <button className="auth-button" type="submit">
                Create
              </button>
              <button
                className="secondary-button"
                type="button"
                onClick={() => setIsCreating(false)}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </main>
  );
}
