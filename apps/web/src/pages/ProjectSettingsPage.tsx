import type { FormEvent } from 'react';
import { useEffect, useState } from 'react';
import type { ProjectSummary } from '@gaussian-viewer/contracts';
import { useAuth } from '../auth.js';
import { ProjectAccess } from '../components/auth/ProjectAccess.js';
import { messageFor } from '../lib/format.js';

export function ProjectSettingsPage({ projectId }: { projectId: string }) {
  const auth = useAuth();
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (auth.status !== 'authenticated') return;
    void (async () => {
      try {
        const response = await auth.authenticatedFetch(`/api/projects/${projectId}`);
        if (!response.ok)
          throw new Error(
            response.status === 403 ? 'You do not own this project.' : 'Project not found.',
          );
        const loaded = (await response.json()) as ProjectSummary;
        setProject(loaded);
        setName(loaded.name);
      } catch (loadError) {
        setError(messageFor(loadError));
      }
    })();
  }, [auth, projectId]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const response = await auth.authenticatedFetch(`/api/projects/${projectId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!response.ok) throw new Error('Project name could not be saved.');
      setProject((await response.json()) as ProjectSummary);
    } catch (saveError) {
      setError(messageFor(saveError));
    }
  }

  return (
    <ProjectAccess>
      <main className="project-detail">
        <a href="/projects">← All projects</a>
        <p className="eyebrow">Project settings</p>
        <h1>{project?.name ?? 'Loading project…'}</h1>
        {error ? <p className="project-error">{error}</p> : null}
        {project ? (
          <form className="project-form" onSubmit={(event) => void save(event)}>
            <label>
              Project name
              <input
                maxLength={120}
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <button className="auth-button" type="submit">
              Save name
            </button>
          </form>
        ) : null}
      </main>
    </ProjectAccess>
  );
}
