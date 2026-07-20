import type { ChangeEvent, FormEvent, PropsWithChildren, ReactNode } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  AssetKind as StoredAssetKind,
  AssetRecord,
  AssetUploadTicket,
  AnnotationComment,
  DefaultCamera,
  MultipartPartUrlTicket,
  OwnerSceneManifest,
  ProjectCoverUploadTicket,
  PublicAssetFormat,
  PublicShareManifest,
  ProjectSummary,
  SceneVariant,
  SceneAnnotation,
  ShareLink,
  SharePermissions,
  Transform,
  UploadSession,
  ViewerSettings,
} from '@gaussian-viewer/contracts';
import {
  HybridViewer,
  createTransformFromEulerDegrees,
  getTransformEulerDegrees,
  setTransformEulerDegrees,
  type AssetKind,
  type AnnotationScreenPosition,
  type TransformGizmoMode,
  type ViewerState,
} from '@gaussian-viewer/viewer-core';
import { AuthProvider, useAuth } from '../../auth.js';
import { SceneLoadingOverlay } from '../viewer/SceneLoadingOverlay.js';

type Vector3 = [number, number, number];
type NudgeSpeed = 'slow' | 'fast';
type EditableAssetKind = Extract<AssetKind, 'environment' | 'building'>;
type InspectorTab = 'assets' | 'layouts' | 'lighting' | 'annotations';
type AnnotationPersistence = 'immediate' | 'debounced' | 'local';
type EditorVisibility = {
  environment: boolean;
  building: boolean;
  sky: boolean;
  annotations: boolean;
};

interface TransformSnapshot {
  environment: Transform;
  building?: Transform;
}

const DIRECT_UPLOAD_LIMIT_BYTES = 100 * 1024 * 1024;

const INITIAL_VIEWER_STATE: ViewerState = {
  status: 'idle',
  message: 'Choose a local .ply or .spz environment and .glb building to start the proof.',
};

export function App() {
  const shareMatch = window.location.pathname.match(/^\/share\/([^/]+)$/);
  if (shareMatch) {
    return <PublicShareViewer token={shareMatch[1]!} />;
  }

  return (
    <AuthProvider>
      <Application />
    </AuthProvider>
  );
}

function Application() {
  const path = window.location.pathname;
  const settingsMatch = path.match(/^\/projects\/([^/]+)\/settings$/);
  const editorMatch = path.match(/^\/projects\/([^/]+)\/editor$/);

  if (settingsMatch) {
    return <ProjectSettings projectId={settingsMatch[1]!} />;
  }
  if (editorMatch) {
    return <ProjectEditorContent projectId={editorMatch[1]!} />;
  }
  return <Home />;
}

function PublicShareViewer({ token }: { token: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewerRef = useRef<HybridViewer | null>(null);
  const [manifest, setManifest] = useState<PublicShareManifest | null>(null);
  const [message, setMessage] = useState('Loading shared projectâ€¦');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const viewer = new HybridViewer(canvas, {
      mobile: window.matchMedia('(max-width: 767px)').matches,
      onStateChange: (state) => setMessage(state.message ?? 'Loading shared projectâ€¦'),
    });
    // Public viewers are intentionally never allowed to attach transform controls.
    viewer.selectAsset(undefined);
    viewerRef.current = viewer;
    return () => {
      viewer.dispose();
      viewerRef.current = null;
    };
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        setError(null);
        const response = await fetch(`/api/public/shares/${encodeURIComponent(token)}/manifest`, {
          cache: 'no-store',
          referrerPolicy: 'no-referrer',
        });
        if (!response.ok) {
          throw new Error('This shared project is unavailable or its link has expired.');
        }
        const loaded = (await response.json()) as PublicShareManifest;
        const viewer = viewerRef.current;
        if (!active || !viewer) return;
        viewer.clearAsset('environment');
        viewer.clearAsset('building');
        if (loaded.environment) {
          const assetResponse = await fetch(loaded.environment.url, {
            referrerPolicy: 'no-referrer',
          });
          if (!assetResponse.ok) throw new Error('The shared environment could not be loaded.');
          await viewer.loadEnvironment(
            new File(
              [await assetResponse.blob()],
              runtimeFilename('environment', loaded.environment.format),
            ),
            loaded.environmentTransform,
          );
        }
        const building = loaded.variants[0];
        if (building) {
          const assetResponse = await fetch(building.asset.url, { referrerPolicy: 'no-referrer' });
          if (!assetResponse.ok) throw new Error('The shared building could not be loaded.');
          await viewer.loadBuilding(
            new File(
              [await assetResponse.blob()],
              runtimeFilename('building', building.asset.format),
            ),
            building.transform,
          );
          viewer.setVisible('building', loaded.viewerSettings.buildingVisible && building.visible);
        }
        viewer.setVisible('environment', loaded.viewerSettings.environmentVisible);
        if (loaded.defaultCamera) viewer.setCamera(loaded.defaultCamera);
        document.title = `${loaded.project.name} â€” Gaussian Viewer`;
        if (active) setManifest(loaded);
      } catch (loadError) {
        if (active) setError(messageFor(loadError));
      }
    })();
    return () => {
      active = false;
    };
  }, [token]);

  return (
    <main className="public-viewer">
      <header className="public-viewer__header">
        <div>
          <p className="eyebrow">Shared project</p>
          <h1>{manifest?.project.name ?? 'Gaussian Viewer'}</h1>
        </div>
        <p className="public-viewer__status" role="status">
          {error ?? message}
        </p>
      </header>
      {error ? (
        <section className="public-viewer__error">
          <h2>Shared project unavailable</h2>
          <p>{error}</p>
        </section>
      ) : (
        <section className="public-viewer__canvas">
          <canvas ref={canvasRef} className="viewer-canvas" aria-label="Shared project scene" />
          <p className="viewer-canvas-wrap__help">
            Drag to orbit Â· scroll to zoom Â· right-drag to pan
          </p>
        </section>
      )}
    </main>
  );
}

function Home() {
  const auth = useAuth();

  if (auth.status === 'loading') {
    return <main className="auth-page">Checking your session…</main>;
  }

  if (auth.status === 'authenticated') {
    return <ProjectsDashboard />;
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

function AppNav({ projectName }: { projectName?: string }) {
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

// Legacy dashboard retained for browser-state compatibility during a hot-reload transition.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function LegacyProjectsDashboard() {
  const auth = useAuth();

  if (auth.status === 'loading') {
    return <main className="auth-page">Checking your session…</main>;
  }

  if (auth.status !== 'authenticated') {
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
  }

  return (
    <main className="auth-page">
      <p className="eyebrow">Owner area</p>
      <h1>Projects</h1>
      <p>Signed in as {auth.user?.email ?? auth.user?.uid}.</p>
      <p>Project records and the dashboard arrive in Phase 4.</p>
      <div className="auth-page__actions">
        <a href="/">Open local viewer</a>
        <button className="auth-button" type="button" onClick={() => void auth.signOut()}>
          Sign out
        </button>
      </div>
    </main>
  );
}

function ProjectsDashboard() {
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
        if (!response.ok) {
          throw new Error('Projects could not be loaded.');
        }
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
      if (!response.ok) {
        throw new Error((await response.json()).error ?? 'Project could not be created.');
      }
      const project = (await response.json()) as ProjectSummary;
      setProjects((current) => [project, ...current]);
      setNewProjectName('');
      setIsCreating(false);
    } catch (createError) {
      setError(messageFor(createError));
    }
  }

  async function deleteProject(project: ProjectSummary) {
    if (!window.confirm(`Delete “${project.name}”? This cannot be undone.`)) {
      return;
    }
    try {
      const response = await auth.authenticatedFetch(`/api/projects/${project.id}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        throw new Error('Project could not be deleted.');
      }
      setProjects((current) => current.filter((item) => item.id !== project.id));
    } catch (deleteError) {
      setError(messageFor(deleteError));
    }
  }

  if (auth.status === 'loading') {
    return <main className="auth-page">Checking your session…</main>;
  }

  if (auth.status !== 'authenticated') {
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
  }

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
            <div className="project-card__cover" aria-label="Cover placeholder">
              No cover
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

// Legacy settings links stay compatible while project naming moves into the editor.
function ProjectSettings({ projectId }: { projectId: string }) {
  const auth = useAuth();
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (auth.status !== 'authenticated') {
      return;
    }
    void (async () => {
      try {
        const response = await auth.authenticatedFetch(`/api/projects/${projectId}`);
        if (!response.ok) {
          throw new Error(
            response.status === 403 ? 'You do not own this project.' : 'Project not found.',
          );
        }
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
      if (!response.ok) {
        throw new Error('Project name could not be saved.');
      }
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

export function ProjectEditorContent({ projectId }: { projectId: string }) {
  const auth = useAuth();
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [projectName, setProjectName] = useState('');
  const [kind, setKind] = useState<StoredAssetKind>('ENVIRONMENT');
  const [isUploading, setIsUploading] = useState(false);
  const [asset, setAsset] = useState<AssetRecord | null>(null);
  const [assetToApply, setAssetToApply] = useState<AssetRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [multipartSession, setMultipartSession] = useState<UploadSession | null>(null);
  const [multipartProgress, setMultipartProgress] = useState<number | null>(null);

  useEffect(() => {
    if (auth.status !== 'authenticated') return;
    void (async () => {
      try {
        const response = await auth.authenticatedFetch(`/api/projects/${projectId}`);
        if (!response.ok) {
          throw new Error(
            response.status === 403 ? 'You do not own this project.' : 'Project not found.',
          );
        }
        const loaded = (await response.json()) as ProjectSummary;
        setProject(loaded);
        setProjectName(loaded.name);
      } catch (loadError) {
        setError(messageFor(loadError));
      }
    })();
  }, [auth, projectId]);

  async function renameProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const response = await auth.authenticatedFetch(`/api/projects/${projectId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: projectName }),
      });
      if (!response.ok) throw new Error('Project name could not be saved.');
      const updated = (await response.json()) as ProjectSummary;
      setProject(updated);
      setProjectName(updated.name);
    } catch (renameError) {
      setError(messageFor(renameError));
    }
  }

  async function uploadAsset(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) {
      return;
    }

    try {
      setIsUploading(true);
      setError(null);
      if (file.size > DIRECT_UPLOAD_LIMIT_BYTES) {
        if (kind !== 'ENVIRONMENT') {
          throw new Error(
            'Large multipart uploads currently support .ply and .spz environments only.',
          );
        }
        const completedAsset = await uploadMultipartAsset(file);
        setAsset(completedAsset);
        setAssetToApply(completedAsset);
        return;
      }
      const checksumSha256 = await sha256Base64(file);
      const request = await auth.authenticatedFetch(`/api/projects/${projectId}/assets/uploads`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind, filename: file.name, size: file.size, checksumSha256 }),
      });
      if (!request.ok) {
        throw new Error((await request.json()).error ?? 'The upload could not be started.');
      }
      const ticket = (await request.json()) as AssetUploadTicket;
      const upload = await fetch(ticket.uploadUrl, {
        method: 'PUT',
        headers: ticket.headers,
        body: file,
      });
      if (!upload.ok) {
        throw new Error('S3 rejected the file upload.');
      }
      const completion = await auth.authenticatedFetch(
        `/api/projects/${projectId}/assets/${ticket.assetId}/complete`,
        { method: 'POST' },
      );
      if (!completion.ok) {
        throw new Error(
          (await completion.json()).error ?? 'The uploaded file could not be validated.',
        );
      }
      const completedAsset = (await completion.json()) as AssetRecord;
      setAsset(completedAsset);
      setAssetToApply(completedAsset);
    } catch (uploadError) {
      setError(messageFor(uploadError));
    } finally {
      setIsUploading(false);
    }
  }

  async function downloadAsset() {
    if (!asset) {
      return;
    }
    try {
      const response = await auth.authenticatedFetch(
        `/api/projects/${projectId}/assets/${asset.id}/download`,
      );
      if (!response.ok) {
        throw new Error('A temporary download link could not be created.');
      }
      window.location.assign(((await response.json()) as { url: string }).url);
    } catch (downloadError) {
      setError(messageFor(downloadError));
    }
  }

  async function uploadMultipartAsset(file: File): Promise<AssetRecord> {
    const storageKey = multipartStorageKey(projectId, file);
    let session = await loadStoredMultipartSession(storageKey);
    if (!session) {
      const response = await auth.authenticatedFetch(
        `/api/projects/${projectId}/uploads/multipart`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ kind: 'ENVIRONMENT', filename: file.name, size: file.size }),
        },
      );
      if (!response.ok) {
        throw new Error(
          (await response.json()).error ?? 'The multipart upload could not be started.',
        );
      }
      session = (await response.json()) as UploadSession;
      localStorage.setItem(storageKey, session.id);
    }
    if (session.state !== 'UPLOADING') {
      localStorage.removeItem(storageKey);
      throw new Error(
        'The saved multipart upload is no longer active. Choose the file again to start over.',
      );
    }
    setMultipartSession(session);
    const completed = await uploadPendingMultipartParts(file, session);
    const completion = await auth.authenticatedFetch(
      `/api/projects/${projectId}/uploads/${completed.id}/complete`,
      { method: 'POST' },
    );
    if (!completion.ok) {
      throw new Error(
        (await completion.json()).error ?? 'The multipart upload could not be completed.',
      );
    }
    localStorage.removeItem(storageKey);
    const completedAsset = (await completion.json()) as AssetRecord;
    setMultipartSession(null);
    setMultipartProgress(null);
    return completedAsset;
  }

  async function loadStoredMultipartSession(storageKey: string): Promise<UploadSession | null> {
    const sessionId = localStorage.getItem(storageKey);
    if (!sessionId) {
      return null;
    }
    const response = await auth.authenticatedFetch(
      `/api/projects/${projectId}/uploads/${sessionId}`,
    );
    if (!response.ok) {
      localStorage.removeItem(storageKey);
      return null;
    }
    return (await response.json()) as UploadSession;
  }

  async function uploadPendingMultipartParts(file: File, initialSession: UploadSession) {
    let session = initialSession;
    for (let partNumber = 1; partNumber <= session.totalParts; partNumber += 1) {
      if (session.parts.some((part) => part.partNumber === partNumber)) {
        updateMultipartProgress(file.size, session);
        continue;
      }
      const start = (partNumber - 1) * session.partSize;
      const part = file.slice(start, Math.min(file.size, start + session.partSize));
      const checksumSha256 = await sha256Base64(part);
      session = await uploadMultipartPartWithRetry(session, partNumber, part, checksumSha256);
      setMultipartSession(session);
      updateMultipartProgress(file.size, session);
    }
    return session;
  }

  async function uploadMultipartPartWithRetry(
    session: UploadSession,
    partNumber: number,
    part: Blob,
    checksumSha256: string,
  ): Promise<UploadSession> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const ticketResponse = await auth.authenticatedFetch(
          `/api/projects/${projectId}/uploads/${session.id}/parts/${partNumber}/url`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ checksumSha256 }),
          },
        );
        if (!ticketResponse.ok) {
          throw new Error('A signed URL for a multipart part could not be created.');
        }
        const ticket = (await ticketResponse.json()) as MultipartPartUrlTicket;
        const upload = await fetch(ticket.url, {
          method: 'PUT',
          headers: ticket.headers,
          body: part,
        });
        const etag = upload.headers.get('etag');
        if (!upload.ok || !etag) {
          throw new Error('S3 rejected a multipart part.');
        }
        const recorded = await auth.authenticatedFetch(
          `/api/projects/${projectId}/uploads/${session.id}/parts/${partNumber}`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ etag, checksumSha256, size: part.size }),
          },
        );
        if (!recorded.ok) {
          throw new Error('The uploaded multipart part could not be recorded.');
        }
        return (await recorded.json()) as UploadSession;
      } catch (uploadError) {
        lastError = uploadError;
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error('A multipart part failed after three attempts.');
  }

  function updateMultipartProgress(fileSize: number, session: UploadSession) {
    const uploadedBytes = session.parts.reduce((total, part) => total + part.size, 0);
    setMultipartProgress(Math.min(100, (uploadedBytes / fileSize) * 100));
  }

  async function deleteAsset() {
    if (!asset || !window.confirm(`Delete “${asset.filename}”?`)) {
      return;
    }
    try {
      const response = await auth.authenticatedFetch(
        `/api/projects/${projectId}/assets/${asset.id}`,
        {
          method: 'DELETE',
        },
      );
      if (!response.ok) {
        throw new Error('The asset could not be deleted.');
      }
      setAsset(null);
    } catch (deleteError) {
      setError(messageFor(deleteError));
    }
  }

  async function abortMultipartUpload() {
    if (
      !multipartSession ||
      !window.confirm('Abort this multipart upload? Uploaded parts will be removed.')
    ) {
      return;
    }
    try {
      const response = await auth.authenticatedFetch(
        `/api/projects/${projectId}/uploads/${multipartSession.id}`,
        { method: 'DELETE' },
      );
      if (!response.ok) {
        throw new Error('The multipart upload could not be aborted.');
      }
      setMultipartSession(null);
      setMultipartProgress(null);
    } catch (abortError) {
      setError(messageFor(abortError));
    }
  }

  return (
    <ProjectAccess>
      <main className="project-detail">
        <a href="/projects">← All projects</a>
        <AppNav projectName={project?.name ?? 'Loading project…'} />
        <header className="editor-heading">
          <div>
            <p className="eyebrow">Project editor</p>
            <h1>{project?.name ?? 'Loading project…'}</h1>
          </div>
          {project ? (
            <form className="project-rename" onSubmit={(event) => void renameProject(event)}>
              <label>
                Project name
                <input
                  maxLength={120}
                  required
                  value={projectName}
                  onChange={(event) => setProjectName(event.target.value)}
                />
              </label>
              <button className="secondary-button" type="submit">
                Save name
              </button>
            </form>
          ) : null}
        </header>
        <PersistentProjectViewer
          projectId={projectId}
          readyAsset={assetToApply}
          onReadyAssetApplied={() => setAssetToApply(null)}
          assetControls={(applyAsset) => (
            <section className="asset-upload" aria-label="Private asset upload">
              <p className="panel__hint">
                Upload GLB assets up to 100 MB, or resumable multipart PLY/SPZ environments. A ready
                upload replaces its matching scene asset automatically.
              </p>
              <label>
                Asset kind
                <select
                  value={kind}
                  onChange={(event) => setKind(event.target.value as StoredAssetKind)}
                >
                  <option value="ENVIRONMENT">Environment (.ply or .spz)</option>
                  <option value="BUILDING">Building (.glb)</option>
                </select>
              </label>
              <label className="file-input">
                <span>
                  {isUploading
                    ? 'Hashing, uploading and validating…'
                    : 'Choose a file (100 MB max)'}
                </span>
                <input
                  type="file"
                  accept={kind === 'ENVIRONMENT' ? '.ply,.spz' : '.glb,model/gltf-binary'}
                  disabled={isUploading}
                  onChange={(event) => void uploadAsset(event)}
                />
              </label>
              {error ? <p className="project-error">{error}</p> : null}
              {multipartSession ? (
                <div className="asset-upload__result">
                  <p>
                    Multipart upload: {multipartSession.parts.length} of{' '}
                    {multipartSession.totalParts} parts recorded
                    {multipartProgress === null ? '.' : ` (${multipartProgress.toFixed(1)}%).`}
                  </p>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => void abortMultipartUpload()}
                  >
                    Abort upload
                  </button>
                </div>
              ) : null}
              {asset ? (
                <div className="asset-upload__result">
                  <p>
                    {asset.filename} is {asset.state.toLowerCase()}.
                  </p>
                  {asset.state === 'READY' ? (
                    <div className="auth-page__actions">
                      <button
                        className="auth-button"
                        type="button"
                        onClick={() => void applyAsset(asset)}
                      >
                        Use in scene
                      </button>
                      <button
                        className="auth-button"
                        type="button"
                        onClick={() => void downloadAsset()}
                      >
                        Download temporarily
                      </button>
                      <button
                        className="secondary-button"
                        type="button"
                        onClick={() => void deleteAsset()}
                      >
                        Remove asset
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </section>
          )}
        />
        <ShareLinks projectId={projectId} />
      </main>
    </ProjectAccess>
  );
}

function ShareLinks({ projectId }: { projectId: string }) {
  const auth = useAuth();
  const [links, setLinks] = useState<ShareLink[]>([]);
  const [expiry, setExpiry] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [latestUrl, setLatestUrl] = useState<string | null>(null);

  useEffect(() => {
    if (auth.status !== 'authenticated') return;
    void loadLinks();

    async function loadLinks() {
      try {
        setIsLoading(true);
        const response = await auth.authenticatedFetch(`/api/projects/${projectId}/shares`);
        if (!response.ok) throw new Error('Share links could not be loaded.');
        setLinks((await response.json()) as ShareLink[]);
      } catch (loadError) {
        setError(messageFor(loadError));
      } finally {
        setIsLoading(false);
      }
    }
  }, [auth, projectId]);

  async function createLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      setIsSaving(true);
      setError(null);
      const response = await auth.authenticatedFetch(`/api/projects/${projectId}/shares`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ expiresAt: expiry ? new Date(expiry).toISOString() : null }),
      });
      if (!response.ok)
        throw new Error((await response.json()).error ?? 'Share link could not be created.');
      const created = (await response.json()) as { link: ShareLink; token: string };
      setLinks((current) => [created.link, ...current]);
      setLatestUrl(shareUrl(created.token));
      setExpiry('');
    } catch (createError) {
      setError(messageFor(createError));
    } finally {
      setIsSaving(false);
    }
  }

  async function updateLink(
    link: ShareLink,
    update: Partial<Pick<ShareLink, 'enabled' | 'expiresAt' | 'permissions'>>,
  ) {
    try {
      setIsSaving(true);
      setError(null);
      const response = await auth.authenticatedFetch(
        `/api/projects/${projectId}/shares/${link.id}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(update),
        },
      );
      if (!response.ok)
        throw new Error((await response.json()).error ?? 'Share link could not be updated.');
      const updated = (await response.json()) as ShareLink;
      setLinks((current) =>
        current.map((candidate) => (candidate.id === updated.id ? updated : candidate)),
      );
    } catch (updateError) {
      setError(messageFor(updateError));
    } finally {
      setIsSaving(false);
    }
  }

  async function regenerateLink(link: ShareLink) {
    if (!window.confirm('Regenerate this link? Anyone using the old address will lose access.'))
      return;
    try {
      setIsSaving(true);
      setError(null);
      const response = await auth.authenticatedFetch(
        `/api/projects/${projectId}/shares/${link.id}/regenerate`,
        { method: 'POST' },
      );
      if (!response.ok)
        throw new Error((await response.json()).error ?? 'Share link could not be regenerated.');
      const updated = (await response.json()) as { link: ShareLink; token: string };
      setLinks((current) =>
        current.map((candidate) => (candidate.id === updated.link.id ? updated.link : candidate)),
      );
      setLatestUrl(shareUrl(updated.token));
    } catch (regenerateError) {
      setError(messageFor(regenerateError));
    } finally {
      setIsSaving(false);
    }
  }

  async function revokeLink(link: ShareLink) {
    if (!window.confirm('Revoke this link permanently? It cannot be re-enabled.')) return;
    try {
      setIsSaving(true);
      setError(null);
      const response = await auth.authenticatedFetch(
        `/api/projects/${projectId}/shares/${link.id}`,
        {
          method: 'DELETE',
        },
      );
      if (!response.ok)
        throw new Error((await response.json()).error ?? 'Share link could not be revoked.');
      const revoked = (await response.json()) as ShareLink;
      setLinks((current) =>
        current.map((candidate) => (candidate.id === revoked.id ? revoked : candidate)),
      );
    } catch (revokeError) {
      setError(messageFor(revokeError));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className="share-links" aria-label="Anonymous sharing">
      <div>
        <p className="eyebrow">Anonymous sharing</p>
        <h2>Share read-only access</h2>
        <p className="panel__hint">
          Links grant read-only access. Revoke stops future manifest requests; already-issued asset
          URLs expire within five minutes.
        </p>
      </div>
      <form className="share-links__create" onSubmit={(event) => void createLink(event)}>
        <label>
          Optional expiry
          <input
            type="datetime-local"
            value={expiry}
            onChange={(event) => setExpiry(event.target.value)}
          />
        </label>
        <button className="auth-button" type="submit" disabled={isSaving}>
          Create share link
        </button>
      </form>
      {latestUrl ? (
        <div className="share-links__token">
          <strong>Copy this new link now.</strong>
          <code>{latestUrl}</code>
          <button
            className="secondary-button"
            type="button"
            onClick={() => void navigator.clipboard.writeText(latestUrl)}
          >
            Copy link
          </button>
        </div>
      ) : null}
      {error ? <p className="project-error">{error}</p> : null}
      {isLoading ? <p className="panel__hint">Loading share linksâ€¦</p> : null}
      <div className="share-links__list">
        {links.map((link) => (
          <ShareLinkCard
            key={link.id}
            link={link}
            disabled={isSaving}
            onUpdate={updateLink}
            onRegenerate={regenerateLink}
            onRevoke={revokeLink}
          />
        ))}
      </div>
    </section>
  );
}

function ShareLinkCard({
  link,
  disabled,
  onUpdate,
  onRegenerate,
  onRevoke,
}: {
  link: ShareLink;
  disabled: boolean;
  onUpdate: (
    link: ShareLink,
    update: Partial<Pick<ShareLink, 'enabled' | 'expiresAt' | 'permissions'>>,
  ) => Promise<void>;
  onRegenerate: (link: ShareLink) => Promise<void>;
  onRevoke: (link: ShareLink) => Promise<void>;
}) {
  const isRevoked = link.revokedAt !== null;
  return (
    <article className="share-link-card">
      <div>
        <strong>{isRevoked ? 'Revoked' : link.enabled ? 'Enabled' : 'Disabled'}</strong>
        <p className="panel__hint">
          Created {formatDate(link.createdAt)}
          {link.expiresAt ? ` Â· expires ${formatDate(link.expiresAt)}` : ' Â· no expiry'}
        </p>
      </div>
      {!isRevoked ? (
        <>
          <Toggle
            label="Enabled"
            checked={link.enabled}
            disabled={disabled}
            onChange={(enabled) => void onUpdate(link, { enabled })}
          />
          <fieldset className="share-link-card__permissions">
            <legend>Presentation permissions</legend>
            <SharePermissionToggle
              label="Allow variant switching"
              name="allowVariantSwitching"
              permissions={link.permissions}
              disabled={disabled}
              onChange={(permissions) => void onUpdate(link, { permissions })}
            />
            <SharePermissionToggle
              label="Show annotations"
              name="showAnnotations"
              permissions={link.permissions}
              disabled={disabled}
              onChange={(permissions) => void onUpdate(link, { permissions })}
            />
            <SharePermissionToggle
              label="Show project description"
              name="showProjectDescription"
              permissions={link.permissions}
              disabled={disabled}
              onChange={(permissions) => void onUpdate(link, { permissions })}
            />
            <SharePermissionToggle
              label="Show technical information"
              name="showTechnicalInformation"
              permissions={link.permissions}
              disabled={disabled}
              onChange={(permissions) => void onUpdate(link, { permissions })}
            />
          </fieldset>
          <div className="auth-page__actions">
            <button
              className="secondary-button"
              type="button"
              disabled={disabled}
              onClick={() => void onRegenerate(link)}
            >
              Regenerate
            </button>
            <button
              className="secondary-button"
              type="button"
              disabled={disabled}
              onClick={() => void onRevoke(link)}
            >
              Revoke
            </button>
          </div>
        </>
      ) : null}
    </article>
  );
}

function SharePermissionToggle({
  label,
  name,
  permissions,
  disabled,
  onChange,
}: {
  label: string;
  name: keyof SharePermissions;
  permissions: SharePermissions;
  disabled: boolean;
  onChange: (permissions: SharePermissions) => void;
}) {
  return (
    <Toggle
      label={label}
      checked={permissions[name]}
      disabled={disabled}
      onChange={(checked) => onChange({ ...permissions, [name]: checked })}
    />
  );
}

function PersistentProjectViewer({
  projectId,
  readyAsset,
  onReadyAssetApplied,
  assetControls,
}: {
  projectId: string;
  readyAsset: AssetRecord | null;
  onReadyAssetApplied: () => void;
  assetControls: (applyAsset: (asset: AssetRecord) => Promise<void>) => ReactNode;
}) {
  const auth = useAuth();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewerRef = useRef<HybridViewer | null>(null);
  const manifestRef = useRef<OwnerSceneManifest | null>(null);
  const serverManifestRef = useRef<OwnerSceneManifest | null>(null);
  const desiredViewerSettingsRef = useRef<ViewerSettings | null>(null);
  const settingsDirtyRef = useRef(false);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const conflictRef = useRef(false);
  const [manifest, setManifest] = useState<OwnerSceneManifest | null>(null);
  const [annotationLabelPositions, setAnnotationLabelPositions] = useState<
    AnnotationScreenPosition[]
  >([]);
  const [editorVisibility, setEditorVisibility] = useState<EditorVisibility>({
    environment: true,
    building: true,
    sky: true,
    annotations: true,
  });
  const [error, setError] = useState<string | null>(null);
  const [isSceneLoading, setIsSceneLoading] = useState(true);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [sceneConflict, setSceneConflict] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [editingKind, setEditingKind] = useState<EditableAssetKind | undefined>('environment');
  const [gizmoMode, setGizmoMode] = useState<TransformGizmoMode>('translate');
  const [buildingOpacity, setBuildingOpacity] = useState(1);
  const [buildingWireframe, setBuildingWireframe] = useState(false);
  const [proxyGroundVisible, setProxyGroundVisible] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [cameraSaveState, setCameraSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('assets');
  const [sunPower, setSunPower] = useState(2.5);
  const [sunColor, setSunColor] = useState('#ffffff');
  const [sunRotation, setSunRotation] = useState<Vector3>([0, 0, 0]);
  const [ambientPower, setAmbientPower] = useState(1.8);
  const [ambientColor, setAmbientColor] = useState('#ffffff');
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | undefined>();
  const [annotationComments, setAnnotationComments] = useState<AnnotationComment[]>([]);
  const [isUpdatingComments, setIsUpdatingComments] = useState(false);
  const transformSaveTimerRef = useRef<number | undefined>(undefined);
  const annotationSaveTimerRef = useRef<number | undefined>(undefined);
  const cameraSaveTimerRef = useRef<number | undefined>(undefined);
  const undoStackRef = useRef<TransformSnapshot[]>([]);
  const initialTransformsRef = useRef<TransformSnapshot | null>(null);
  const selectionBeforeLightingRef = useRef<{
    kind: EditableAssetKind | undefined;
    gizmoMode: TransformGizmoMode;
  } | null>(null);
  const buildingOpacityRef = useRef(buildingOpacity);
  const buildingWireframeRef = useRef(buildingWireframe);
  const proxyGroundVisibleRef = useRef(proxyGroundVisible);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const viewer = new HybridViewer(canvas, {
      mobile: window.matchMedia('(max-width: 767px)').matches,
      onTransformStart: () => recordTransformHistory(),
      onTransformChange: (kind, transform) => updateTransform(kind, transform, false),
      onSunRotationChange: (rotationDegrees) => updateSunSettings({ rotationDegrees }),
      onAnnotationClick: (annotationId) => selectAnnotation(annotationId),
      onAnnotationTransformChange: (annotationId, position) =>
        updateAnnotation(annotationId, { position }, 'debounced'),
    });
    viewer.selectAsset(editingKind);
    viewer.setTransformGizmoMode(gizmoMode);
    viewer.setTransformGizmoVisible(false);
    viewer.setProxyGroundVisible(proxyGroundVisibleRef.current);
    viewerRef.current = viewer;
    return () => {
      viewer.dispose();
      viewerRef.current = null;
      if (transformSaveTimerRef.current !== undefined) {
        window.clearTimeout(transformSaveTimerRef.current);
      }
      if (annotationSaveTimerRef.current !== undefined) {
        window.clearTimeout(annotationSaveTimerRef.current);
      }
      if (cameraSaveTimerRef.current !== undefined) {
        window.clearTimeout(cameraSaveTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    let frame = 0;
    let active = true;
    const update = () => {
      if (!active) return;
      setAnnotationLabelPositions(viewerRef.current?.getAnnotationScreenPositions() ?? []);
      frame = window.requestAnimationFrame(update);
    };
    frame = window.requestAnimationFrame(update);
    return () => {
      active = false;
      window.cancelAnimationFrame(frame);
    };
  }, []);

  useEffect(() => {
    if (auth.status !== 'authenticated' || !viewerRef.current) return;
    let active = true;
    void (async () => {
      try {
        setIsSceneLoading(true);
        const response = await auth.authenticatedFetch(`/api/projects/${projectId}/manifest`);
        if (!response.ok) throw new Error('The project scene could not be loaded.');
        const loaded = (await response.json()) as OwnerSceneManifest;
        const viewer = viewerRef.current;
        if (!viewer || !active) return;
        viewer.setSkyVisible(loaded.viewerSettings.sky.visible);
        viewer.setSkyRotation(loaded.viewerSettings.sky.rotationYDegrees);
        viewer.setSunPower(loaded.viewerSettings.lighting.sun.power);
        viewer.setSunColor(loaded.viewerSettings.lighting.sun.color);
        viewer.setSunRotation(loaded.viewerSettings.lighting.sun.rotationDegrees);
        viewer.setAmbientPower(loaded.viewerSettings.lighting.ambient.power);
        viewer.setAmbientColor(loaded.viewerSettings.lighting.ambient.color);
        viewer.setAnnotations(loaded.annotations, loaded.annotationScale);
        viewer.clearAsset('environment');
        viewer.clearAsset('building');
        if (loaded.environment) {
          const assetResponse = await fetch(loaded.environment.url);
          if (!assetResponse.ok) throw new Error('The temporary environment download failed.');
          await viewer.loadEnvironment(
            new File([await assetResponse.blob()], loaded.environment.filename),
            loaded.environmentTransform,
          );
        }
        const building = loaded.variants[0];
        if (building) {
          const assetResponse = await fetch(building.url);
          if (!assetResponse.ok) throw new Error('The temporary building download failed.');
          await viewer.loadBuilding(
            new File([await assetResponse.blob()], building.filename),
            building.transform,
          );
          viewer.setBuildingOpacity(buildingOpacityRef.current);
          viewer.setBuildingWireframe(buildingWireframeRef.current);
        }
        if (!active) return;
        viewer.setVisible('environment', loaded.viewerSettings.environmentVisible);
        viewer.setVisible(
          'building',
          Boolean(building?.visible) && loaded.viewerSettings.buildingVisible,
        );
        viewer.setAnnotationsVisible(true);
        if (loaded.defaultCamera) viewer.setCamera(loaded.defaultCamera);
        serverManifestRef.current = loaded;
        manifestRef.current = loaded;
        initialTransformsRef.current = transformsFromManifest(loaded);
        undoStackRef.current = [];
        desiredViewerSettingsRef.current = loaded.viewerSettings;
        settingsDirtyRef.current = false;
        conflictRef.current = false;
        setManifest(loaded);
        setCanUndo(false);
        setSunPower(loaded.viewerSettings.lighting.sun.power);
        setSunColor(loaded.viewerSettings.lighting.sun.color);
        setSunRotation(loaded.viewerSettings.lighting.sun.rotationDegrees);
        setAmbientPower(loaded.viewerSettings.lighting.ambient.power);
        setAmbientColor(loaded.viewerSettings.lighting.ambient.color);
        setSettingsDirty(false);
        setEditorVisibility({
          environment: loaded.viewerSettings.environmentVisible,
          building: Boolean(building?.visible) && loaded.viewerSettings.buildingVisible,
          sky: loaded.viewerSettings.sky.visible,
          annotations: true,
        });
        setSceneConflict(false);
        setError(null);
      } catch (loadError) {
        if (active) setError(messageFor(loadError));
      } finally {
        if (active) setIsSceneLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [auth, projectId, reloadNonce]);

  function enqueueSceneUpdate(update: {
    environmentAssetId?: string | null;
    environmentTransform?: OwnerSceneManifest['environmentTransform'];
    variants?: SceneVariant[];
    annotations?: SceneAnnotation[];
    annotationScale?: number;
    viewerSettings?: ViewerSettings;
    defaultCamera?: DefaultCamera | null;
  }): Promise<boolean> {
    const run = async (): Promise<boolean> => {
      if (conflictRef.current) return false;
      const base = serverManifestRef.current;
      if (!base) return false;

      try {
        const response = await auth.authenticatedFetch(`/api/projects/${projectId}/scene`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            revision: base.revision,
            environmentAssetId:
              update.environmentAssetId === undefined
                ? (base.environment?.id ?? null)
                : update.environmentAssetId,
            environmentTransform: update.environmentTransform ?? base.environmentTransform,
            variants: update.variants ?? base.variants,
            viewerSettings: update.viewerSettings ?? base.viewerSettings,
            defaultCamera:
              update.defaultCamera === undefined ? base.defaultCamera : update.defaultCamera,
            annotations: update.annotations ?? base.annotations,
            annotationScale: update.annotationScale ?? base.annotationScale,
          }),
        });
        if (response.status === 409) {
          conflictRef.current = true;
          setSceneConflict(true);
          setError('Scene changed in another tab. Reload the project before changing settings.');
          return false;
        }
        if (!response.ok) throw new Error('Viewer settings could not be saved.');

        const saved = (await response.json()) as OwnerSceneManifest;
        serverManifestRef.current = saved;
        const local = manifestRef.current;
        const optimistic = local
          ? {
              ...saved,
              environmentTransform: local.environmentTransform,
              variants: local.variants,
              viewerSettings: desiredViewerSettingsRef.current ?? saved.viewerSettings,
              annotations: update.annotations ?? local.annotations,
              annotationScale: update.annotationScale ?? local.annotationScale,
            }
          : saved;
        manifestRef.current = optimistic;
        setManifest(optimistic);
        return true;
      } catch (saveError) {
        setError(messageFor(saveError));
        return false;
      }
    };
    const queued = saveQueueRef.current.then(run, run);
    saveQueueRef.current = queued.then(() => undefined);
    return queued;
  }

  function flushViewerSettings(): Promise<boolean> {
    const settings = desiredViewerSettingsRef.current;
    if (!settingsDirtyRef.current || !settings) return Promise.resolve(true);
    settingsDirtyRef.current = false;
    setSettingsDirty(false);
    return enqueueSceneUpdate({ viewerSettings: settings });
  }

  async function saveOpeningCamera() {
    const viewer = viewerRef.current;
    if (!viewer || !manifest) return;
    if (cameraSaveTimerRef.current !== undefined) {
      window.clearTimeout(cameraSaveTimerRef.current);
    }
    setCameraSaveState('saving');
    try {
      const thumbnail = await viewer.captureScreenshot();
      const camera = viewer.getCamera();
      const settingsSaved = await flushViewerSettings();
      const cameraSaved = settingsSaved && (await enqueueSceneUpdate({ defaultCamera: camera }));
      if (!cameraSaved) {
        setCameraSaveState('idle');
        return;
      }
      await uploadProjectCover(thumbnail);
      setCameraSaveState('saved');
      cameraSaveTimerRef.current = window.setTimeout(() => setCameraSaveState('idle'), 3_000);
    } catch (saveError) {
      setError(messageFor(saveError));
      setCameraSaveState('idle');
    }
  }

  async function uploadProjectCover(thumbnail: Blob): Promise<void> {
    const checksumSha256 = await sha256Base64(thumbnail);
    const request = await auth.authenticatedFetch(`/api/projects/${projectId}/cover/upload`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ size: thumbnail.size, checksumSha256 }),
    });
    if (!request.ok) {
      throw new Error((await request.json()).error ?? 'The thumbnail upload could not be started.');
    }
    const ticket = (await request.json()) as ProjectCoverUploadTicket;
    const upload = await fetch(ticket.uploadUrl, {
      method: 'PUT',
      headers: ticket.headers,
      body: thumbnail,
    });
    if (!upload.ok) throw new Error('S3 rejected the thumbnail upload.');
    const completion = await auth.authenticatedFetch(`/api/projects/${projectId}/cover/complete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ size: thumbnail.size, checksumSha256 }),
    });
    if (!completion.ok) {
      throw new Error(
        (await completion.json()).error ?? 'The uploaded thumbnail could not be verified.',
      );
    }
  }

  useEffect(() => {
    if (!manifest || !settingsDirty) return;
    const timeout = window.setTimeout(() => {
      void flushViewerSettings();
    }, 600);
    return () => window.clearTimeout(timeout);
  }, [manifest, settingsDirty]);

  function updateEditorVisibility(kind: keyof EditorVisibility, visible: boolean) {
    setEditorVisibility((current) => ({ ...current, [kind]: visible }));
    if (kind === 'annotations') {
      viewerRef.current?.setAnnotationsVisible(visible);
    } else if (kind === 'sky') {
      viewerRef.current?.setSkyVisible(visible);
    } else {
      viewerRef.current?.setVisible(kind, visible);
    }
  }

  function updateSkySettings(update: Partial<ViewerSettings['sky']>) {
    const current = manifestRef.current;
    if (!current || conflictRef.current) return;
    const sky = { ...current.viewerSettings.sky, ...update };
    if (update.visible !== undefined) updateEditorVisibility('sky', update.visible);
    if (update.rotationYDegrees !== undefined) {
      viewerRef.current?.setSkyRotation(update.rotationYDegrees);
    }
    const updated = {
      ...current,
      viewerSettings: { ...current.viewerSettings, sky },
    };
    manifestRef.current = updated;
    desiredViewerSettingsRef.current = updated.viewerSettings;
    setManifest(updated);
    settingsDirtyRef.current = true;
    setSettingsDirty(true);
  }

  function updateSunSettings(update: Partial<ViewerSettings['lighting']['sun']>) {
    if (update.power !== undefined) setSunPower(update.power);
    if (update.color !== undefined) setSunColor(update.color);
    if (update.rotationDegrees !== undefined) setSunRotation(update.rotationDegrees);

    const current = manifestRef.current;
    if (!current || conflictRef.current) return;
    const sun = { ...current.viewerSettings.lighting.sun, ...update };
    if (update.power !== undefined) viewerRef.current?.setSunPower(update.power);
    if (update.color !== undefined) viewerRef.current?.setSunColor(update.color);
    if (update.rotationDegrees !== undefined) {
      viewerRef.current?.setSunRotation(update.rotationDegrees);
    }
    const updated = {
      ...current,
      viewerSettings: {
        ...current.viewerSettings,
        lighting: { ...current.viewerSettings.lighting, sun },
      },
    };
    manifestRef.current = updated;
    desiredViewerSettingsRef.current = updated.viewerSettings;
    setManifest(updated);
    settingsDirtyRef.current = true;
    setSettingsDirty(true);
  }

  function updateAmbientSettings(update: Partial<ViewerSettings['lighting']['ambient']>) {
    if (update.power !== undefined) setAmbientPower(update.power);
    if (update.color !== undefined) setAmbientColor(update.color);

    const current = manifestRef.current;
    if (!current || conflictRef.current) return;
    const ambient = { ...current.viewerSettings.lighting.ambient, ...update };
    if (update.power !== undefined) viewerRef.current?.setAmbientPower(update.power);
    if (update.color !== undefined) viewerRef.current?.setAmbientColor(update.color);
    const updated = {
      ...current,
      viewerSettings: {
        ...current.viewerSettings,
        lighting: { ...current.viewerSettings.lighting, ambient },
      },
    };
    manifestRef.current = updated;
    desiredViewerSettingsRef.current = updated.viewerSettings;
    setManifest(updated);
    settingsDirtyRef.current = true;
    setSettingsDirty(true);
  }

  function currentTransformSnapshot(): TransformSnapshot | null {
    const current = manifestRef.current;
    if (!current) return null;
    return transformsFromManifest(current);
  }

  function recordTransformHistory(snapshot = currentTransformSnapshot()): void {
    if (!snapshot) return;
    const previous = undoStackRef.current.at(-1);
    if (previous && transformsMatch(previous, snapshot)) return;
    undoStackRef.current.push(cloneTransformSnapshot(snapshot));
    setCanUndo(true);
  }

  function clearPendingTransformSave(): void {
    if (transformSaveTimerRef.current !== undefined) {
      window.clearTimeout(transformSaveTimerRef.current);
      transformSaveTimerRef.current = undefined;
    }
  }

  function updateTransform(kind: EditableAssetKind, transform: Transform, recordHistory = true) {
    const current = manifestRef.current;
    if (!current || conflictRef.current) return;
    if (recordHistory) recordTransformHistory();
    const variants =
      kind === 'building' && current.variants[0]
        ? [{ ...current.variants[0], transform }]
        : current.variants;
    const updated = {
      ...current,
      environmentTransform: kind === 'environment' ? transform : current.environmentTransform,
      variants,
    };
    if (kind === 'environment') {
      viewerRef.current?.setEnvironmentTransform(transform);
    } else {
      viewerRef.current?.setBuildingTransform(transform);
    }
    manifestRef.current = updated;
    setManifest(updated);
    clearPendingTransformSave();
    transformSaveTimerRef.current = window.setTimeout(() => {
      transformSaveTimerRef.current = undefined;
      const pending = manifestRef.current;
      if (!pending) return;
      void enqueueSceneUpdate(
        kind === 'environment'
          ? { environmentTransform: pending.environmentTransform }
          : { variants: pending.variants },
      );
    }, 500);
  }

  function applyTransformSnapshot(snapshot: TransformSnapshot): void {
    const current = manifestRef.current;
    if (!current || conflictRef.current) return;
    const variants = current.variants[0]
      ? [
          {
            ...current.variants[0],
            transform: cloneTransform(snapshot.building ?? current.variants[0].transform),
          },
        ]
      : current.variants;
    const updated = {
      ...current,
      environmentTransform: cloneTransform(snapshot.environment),
      variants,
    };
    viewerRef.current?.setEnvironmentTransform(updated.environmentTransform);
    if (updated.variants[0]) viewerRef.current?.setBuildingTransform(updated.variants[0].transform);
    manifestRef.current = updated;
    setManifest(updated);
    clearPendingTransformSave();
    void enqueueSceneUpdate({
      environmentTransform: updated.environmentTransform,
      variants: updated.variants,
    });
  }

  function undoLastTransform(): void {
    const previous = undoStackRef.current.pop();
    if (!previous) return;
    setCanUndo(undoStackRef.current.length > 0);
    applyTransformSnapshot(previous);
  }

  function resetSessionTransforms(): void {
    const initial = initialTransformsRef.current;
    const current = currentTransformSnapshot();
    if (!initial || !current || transformsMatch(initial, current)) return;
    recordTransformHistory(current);
    applyTransformSnapshot(initial);
  }

  function selectEditingAsset(kind: EditableAssetKind | undefined): void {
    setEditingKind(kind);
    viewerRef.current?.selectAsset(kind);
  }

  function selectAnnotation(annotationId: string | undefined): void {
    setSelectedAnnotationId(annotationId);
    if (annotationId) {
      setEditingKind(undefined);
      setGizmoMode('translate');
      viewerRef.current?.selectAnnotation(annotationId);
      viewerRef.current?.setTransformGizmoMode('translate');
    } else {
      viewerRef.current?.selectAsset(editingKind);
    }
  }

  function updateAnnotation(
    annotationId: string,
    changes: Partial<SceneAnnotation>,
    persistence: AnnotationPersistence = 'immediate',
  ): void {
    const current = manifestRef.current;
    if (!current || conflictRef.current) return;
    const annotations = current.annotations.map((annotation) =>
      annotation.id === annotationId ? { ...annotation, ...changes } : annotation,
    );
    const updated = { ...current, annotations };
    manifestRef.current = updated;
    if (changes.position && Object.keys(changes).length === 1) {
      viewerRef.current?.setAnnotationPosition(annotationId, changes.position);
    } else {
      viewerRef.current?.setAnnotations(annotations, current.annotationScale);
      viewerRef.current?.selectAnnotation(selectedAnnotationId);
    }
    setManifest(updated);
    if (persistence === 'immediate') {
      void enqueueSceneUpdate({ annotations });
      return;
    }
    if (persistence === 'local') {
      if (annotationSaveTimerRef.current !== undefined) {
        window.clearTimeout(annotationSaveTimerRef.current);
        annotationSaveTimerRef.current = undefined;
      }
      return;
    }
    if (annotationSaveTimerRef.current !== undefined) {
      window.clearTimeout(annotationSaveTimerRef.current);
    }
    annotationSaveTimerRef.current = window.setTimeout(() => {
      annotationSaveTimerRef.current = undefined;
      const pending = manifestRef.current;
      if (pending) void enqueueSceneUpdate({ annotations: pending.annotations });
    }, 500);
  }

  function updateAnnotationScale(annotationScale: number, persist = true): void {
    const current = manifestRef.current;
    if (
      !current ||
      conflictRef.current ||
      !Number.isFinite(annotationScale) ||
      annotationScale <= 0
    ) {
      return;
    }
    const updated = { ...current, annotationScale };
    manifestRef.current = updated;
    viewerRef.current?.setAnnotationScale(annotationScale);
    setManifest(updated);
    if (persist) void enqueueSceneUpdate({ annotationScale });
  }

  function saveAnnotations(): void {
    const current = manifestRef.current;
    if (current && !conflictRef.current) {
      void enqueueSceneUpdate({ annotations: current.annotations });
    }
  }

  function saveAnnotationScale(): void {
    const current = manifestRef.current;
    if (current && !conflictRef.current) {
      void enqueueSceneUpdate({ annotationScale: current.annotationScale });
    }
  }

  function addAnnotation(): void {
    const current = manifestRef.current;
    if (!current || conflictRef.current) return;
    const annotation: SceneAnnotation = {
      id: crypto.randomUUID(),
      position: [0, 0, 0],
      title: 'New annotation',
      description: '',
      color: '#78b8f6',
      labelOffset: [16, -8, 0],
      visibility: 'PUBLIC',
    };
    const annotations = [...current.annotations, annotation];
    const updated = { ...current, annotations };
    manifestRef.current = updated;
    viewerRef.current?.setAnnotations(annotations, current.annotationScale);
    setManifest(updated);
    setSelectedAnnotationId(annotation.id);
    setEditingKind(undefined);
    viewerRef.current?.selectAnnotation(annotation.id);
    void enqueueSceneUpdate({ annotations });
  }

  function deleteAnnotation(annotationId: string): void {
    const current = manifestRef.current;
    if (!current || conflictRef.current) return;
    const annotations = current.annotations.filter((annotation) => annotation.id !== annotationId);
    const updated = { ...current, annotations };
    manifestRef.current = updated;
    viewerRef.current?.setAnnotations(annotations, current.annotationScale);
    setSelectedAnnotationId(undefined);
    viewerRef.current?.selectAsset(editingKind);
    setManifest(updated);
    void enqueueSceneUpdate({ annotations });
  }

  async function loadAnnotationComments(): Promise<void> {
    try {
      const response = await auth.authenticatedFetch(
        `/api/projects/${projectId}/annotation-comments`,
      );
      if (!response.ok) throw new Error('Investor comments could not be loaded.');
      setAnnotationComments((await response.json()) as AnnotationComment[]);
    } catch (loadError) {
      setError(messageFor(loadError));
    }
  }

  async function acknowledgeAnnotationComments(): Promise<void> {
    try {
      setIsUpdatingComments(true);
      const response = await auth.authenticatedFetch(
        `/api/projects/${projectId}/annotation-comments/acknowledge`,
        { method: 'POST' },
      );
      if (!response.ok) throw new Error('Investor comments could not be acknowledged.');
      const readAt = new Date().toISOString();
      setAnnotationComments((current) =>
        current.map((comment) => ({ ...comment, readAt: comment.readAt ?? readAt })),
      );
    } catch (acknowledgeError) {
      setError(messageFor(acknowledgeError));
    } finally {
      setIsUpdatingComments(false);
    }
  }

  async function deleteAnnotationComment(comment: AnnotationComment): Promise<void> {
    if (!window.confirm(`Delete this comment from ${comment.name}? This cannot be undone.`)) return;
    try {
      setIsUpdatingComments(true);
      const response = await auth.authenticatedFetch(
        `/api/projects/${projectId}/annotation-comments/${encodeURIComponent(comment.id)}`,
        { method: 'DELETE' },
      );
      if (!response.ok) throw new Error('Investor comment could not be deleted.');
      setAnnotationComments((current) => current.filter((item) => item.id !== comment.id));
    } catch (deleteError) {
      setError(messageFor(deleteError));
    } finally {
      setIsUpdatingComments(false);
    }
  }

  function openCommentAnnotation(annotationId: string): void {
    if (!manifestRef.current?.annotations.some((annotation) => annotation.id === annotationId)) {
      return;
    }
    changeInspectorTab('annotations');
    selectAnnotation(annotationId);
  }

  useEffect(() => {
    if (auth.status === 'authenticated') void loadAnnotationComments();
  }, [auth, projectId]);

  function changeGizmoMode(mode: TransformGizmoMode): void {
    setGizmoMode(mode);
    viewerRef.current?.setTransformGizmoMode(mode);
  }

  function changeInspectorTab(tab: InspectorTab): void {
    if (tab === inspectorTab) return;
    const viewer = viewerRef.current;

    if (tab === 'assets') {
      viewer?.setTransformGizmoVisible(false);
    } else if (inspectorTab === 'assets') {
      viewer?.setTransformGizmoVisible(true);
    }

    if (inspectorTab === 'lighting') {
      const previous = selectionBeforeLightingRef.current;
      viewer?.endSunRotationEdit();
      if (previous) {
        setEditingKind(previous.kind);
        setGizmoMode(previous.gizmoMode);
        viewer?.selectAsset(previous.kind);
        viewer?.setTransformGizmoMode(previous.gizmoMode);
      }
      selectionBeforeLightingRef.current = null;
    }

    if (tab === 'lighting') {
      selectionBeforeLightingRef.current = { kind: editingKind, gizmoMode };
      setGizmoMode('rotate');
      viewer?.beginSunRotationEdit(sunRotation);
    }
    if (tab === 'annotations') void loadAnnotationComments();
    setInspectorTab(tab);
  }

  function changeBuildingOpacity(opacity: number): void {
    buildingOpacityRef.current = opacity;
    setBuildingOpacity(opacity);
    viewerRef.current?.setBuildingOpacity(opacity);
  }

  function changeBuildingWireframe(wireframe: boolean): void {
    buildingWireframeRef.current = wireframe;
    setBuildingWireframe(wireframe);
    viewerRef.current?.setBuildingWireframe(wireframe);
  }

  function changeProxyGroundVisible(visible: boolean): void {
    proxyGroundVisibleRef.current = visible;
    setProxyGroundVisible(visible);
    viewerRef.current?.setProxyGroundVisible(visible);
  }

  async function addReadyAssetToScene(asset: AssetRecord) {
    if (!manifestRef.current || conflictRef.current) return;
    if (asset.kind === 'ENVIRONMENT') {
      await enqueueSceneUpdate({ environmentAssetId: asset.id });
    } else if (asset.kind === 'BUILDING') {
      await enqueueSceneUpdate({
        variants: [
          {
            id: asset.id,
            assetId: asset.id,
            name: asset.filename.replace(/\.glb$/i, '') || 'Building',
            transform: {
              position: [0, 0, 0],
              quaternion: [0, 0, 0, 1],
              scale: [1, 1, 1],
            },
            visible: true,
            displayOrder: 0,
          },
        ],
      });
    }
    setReloadNonce((current) => current + 1);
  }

  useEffect(() => {
    if (!readyAsset || !manifest || conflictRef.current) return;
    let active = true;
    void addReadyAssetToScene(readyAsset).finally(() => {
      if (active) onReadyAssetApplied();
    });
    return () => {
      active = false;
    };
  }, [manifest, onReadyAssetApplied, readyAsset]);

  const selectedTransform =
    editingKind === 'environment'
      ? manifest?.environmentTransform
      : editingKind === 'building'
        ? manifest?.variants[0]?.transform
        : undefined;

  return (
    <section className="project-viewer">
      <div className="project-viewer__actions">
        <h2>Editor visibility</h2>
        <div className="auth-page__actions">
          <Toggle
            label="Environment"
            checked={editorVisibility.environment}
            onChange={(visible) => updateEditorVisibility('environment', visible)}
            disabled={!manifest}
          />
          <Toggle
            label="Building"
            checked={editorVisibility.building}
            onChange={(visible) => updateEditorVisibility('building', visible)}
            disabled={!manifest}
          />
          <Toggle
            label="Sky"
            checked={editorVisibility.sky}
            onChange={(visible) => updateEditorVisibility('sky', visible)}
            disabled={!manifest}
          />
          <Toggle
            label="Annotations"
            checked={editorVisibility.annotations}
            onChange={(visible) => updateEditorVisibility('annotations', visible)}
            disabled={!manifest}
          />
          <button
            className="auth-button"
            type="button"
            disabled={!manifest || sceneConflict || cameraSaveState === 'saving'}
            onClick={() => void saveOpeningCamera()}
          >
            {cameraSaveState === 'saving' ? 'Saving camera…' : 'Save opening camera'}
          </button>
          {cameraSaveState === 'saved' ? (
            <p className="camera-save-status" role="status">
              Camera view and thumbnail saved
            </p>
          ) : null}
          {sceneConflict ? (
            <button
              className="secondary-button"
              type="button"
              onClick={() => setReloadNonce((current) => current + 1)}
            >
              Reload scene
            </button>
          ) : null}
        </div>
      </div>
      {error ? <p className="project-error">{error}</p> : null}
      <div className="project-viewer__workspace">
        <aside className="panel panel--controls" aria-label="Editor inspector">
          <div className="inspector-tabs" role="tablist" aria-label="Editor panels">
            {(['assets', 'layouts', 'lighting', 'annotations'] as const).map((tab) => (
              <button
                key={tab}
                className={
                  inspectorTab === tab ? 'inspector-tabs__tab is-active' : 'inspector-tabs__tab'
                }
                type="button"
                role="tab"
                aria-selected={inspectorTab === tab}
                onClick={() => changeInspectorTab(tab)}
              >
                {tab === 'layouts' ? 'Layouts' : tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>
          {inspectorTab === 'assets' ? assetControls(addReadyAssetToScene) : null}
          {inspectorTab === 'layouts' ? (
            <>
              <section>
                <h2>Object layout</h2>
                <label className="speed-select">
                  <span>Object</span>
                  <select
                    value={editingKind ?? 'none'}
                    disabled={!manifest || sceneConflict}
                    onChange={(event) =>
                      selectEditingAsset(
                        event.target.value === 'none'
                          ? undefined
                          : (event.target.value as EditableAssetKind),
                      )
                    }
                  >
                    <option value="none">None</option>
                    <option value="environment">Environment</option>
                    <option value="building" disabled={!manifest?.variants[0]}>
                      Building
                    </option>
                  </select>
                </label>
                <label className="speed-select">
                  <span>Gizmo</span>
                  <select
                    value={gizmoMode}
                    disabled={!manifest || sceneConflict}
                    onChange={(event) => changeGizmoMode(event.target.value as TransformGizmoMode)}
                  >
                    <option value="translate">Move</option>
                    <option value="rotate">Rotate</option>
                  </select>
                </label>
                <p className="panel__hint">
                  Select an object, then drag its move or rotate gizmo. Position is in metres and
                  rotation is Euler XYZ degrees. Transforms save automatically.
                </p>
                {editingKind && selectedTransform ? (
                  <details className="numeric-transform-controls">
                    <summary>Numeric alignment</summary>
                    <TransformControls
                      kind={editingKind}
                      transform={selectedTransform}
                      disabled={
                        sceneConflict || (editingKind === 'building' && !manifest?.variants[0])
                      }
                      onChange={(transform) => updateTransform(editingKind, transform)}
                    />
                  </details>
                ) : (
                  <p className="panel__hint">
                    {editingKind
                      ? 'Upload and apply a building to edit its placement.'
                      : 'Choose an object to show its transform controls.'}
                  </p>
                )}
              </section>
              <section>
                <h2>Display</h2>
                <label className="opacity-control">
                  <span>Building opacity</span>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={buildingOpacity}
                    disabled={!manifest?.variants[0]}
                    onChange={(event) => changeBuildingOpacity(Number(event.target.value))}
                  />
                </label>
                <Toggle
                  label="Building wireframe"
                  checked={buildingWireframe}
                  disabled={!manifest?.variants[0]}
                  onChange={changeBuildingWireframe}
                />
                <Toggle
                  label="Proxy ground"
                  checked={proxyGroundVisible}
                  onChange={changeProxyGroundVisible}
                />
                <p className="panel__hint">Display controls are local to this editing session.</p>
              </section>
              <section>
                <h2>Edit session</h2>
                <div className="auth-page__actions">
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={!canUndo || sceneConflict}
                    onClick={undoLastTransform}
                  >
                    Undo transform
                  </button>
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={!initialTransformsRef.current || sceneConflict}
                    onClick={resetSessionTransforms}
                  >
                    Reset session
                  </button>
                </div>
                <p className="panel__hint">
                  Reset restores the alignment that was loaded for this session.
                </p>
              </section>
            </>
          ) : null}
          {inspectorTab === 'lighting' ? (
            <section className="lighting-controls">
              <h2>Lighting</h2>
              <Toggle
                label="Show sky in shared viewer"
                checked={manifest?.viewerSettings.sky.visible ?? true}
                disabled={!manifest || sceneConflict}
                onChange={(visible) => updateSkySettings({ visible })}
              />
              <p className="panel__hint">
                The rotation gizmo is attached to a center-origin light handle while this tab is
                open. Your previous object selection is restored when you leave it.
              </p>
              <label className="transform-controls__row">
                <span>Sky Y rotation (°)</span>
                <input
                  type="number"
                  step="1"
                  value={manifest?.viewerSettings.sky.rotationYDegrees ?? 0}
                  disabled={!manifest || sceneConflict}
                  onChange={(event) => {
                    const rotationYDegrees = Number(event.target.value);
                    if (Number.isFinite(rotationYDegrees)) {
                      updateSkySettings({ rotationYDegrees });
                    }
                  }}
                />
              </label>
              <label className="transform-controls__row">
                <span>Sun power</span>
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  value={sunPower}
                  onChange={(event) => {
                    const power = Number(event.target.value);
                    if (Number.isFinite(power) && power >= 0) {
                      updateSunSettings({ power });
                    }
                  }}
                />
              </label>
              <label className="color-control">
                <span>Sun color</span>
                <input
                  type="color"
                  value={sunColor}
                  onChange={(event) => updateSunSettings({ color: event.target.value })}
                />
              </label>
              <NumericVector
                label="Sun rotation (degrees)"
                values={sunRotation}
                disabled={false}
                onChange={(index, rawValue) => {
                  const value = Number(rawValue);
                  if (!Number.isFinite(value)) return;
                  const rotation = replaceAt(sunRotation, index, value);
                  updateSunSettings({ rotationDegrees: rotation });
                }}
              />
              <label className="transform-controls__row">
                <span>Ambient power</span>
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  value={ambientPower}
                  onChange={(event) => {
                    const power = Number(event.target.value);
                    if (Number.isFinite(power) && power >= 0) {
                      updateAmbientSettings({ power });
                    }
                  }}
                />
              </label>
              <label className="color-control">
                <span>Ambient color</span>
                <input
                  type="color"
                  value={ambientColor}
                  onChange={(event) => updateAmbientSettings({ color: event.target.value })}
                />
              </label>
              <p className="panel__hint">Lighting changes save automatically with the scene.</p>
            </section>
          ) : null}
          {inspectorTab === 'annotations' ? (
            <section className="annotation-controls">
              <h2>Annotations</h2>
              <label className="transform-controls__row">
                <span>Global marker scale</span>
                <input
                  type="number"
                  min="0.1"
                  max="100"
                  step="0.1"
                  value={manifest?.annotationScale ?? 10}
                  disabled={!manifest || sceneConflict}
                  onChange={(event) => updateAnnotationScale(Number(event.target.value), false)}
                  onBlur={saveAnnotationScale}
                />
              </label>
              <button
                className="auth-button"
                type="button"
                disabled={!manifest || sceneConflict}
                onClick={addAnnotation}
              >
                Add annotation
              </button>
              <label className="speed-select">
                <span>Annotation</span>
                <select
                  value={selectedAnnotationId ?? 'none'}
                  disabled={!manifest || sceneConflict}
                  onChange={(event) =>
                    selectAnnotation(event.target.value === 'none' ? undefined : event.target.value)
                  }
                >
                  <option value="none">Select an annotation</option>
                  {manifest?.annotations.map((annotation) => (
                    <option key={annotation.id} value={annotation.id}>
                      {annotation.title}
                    </option>
                  ))}
                </select>
              </label>
              {selectedAnnotationId ? (
                (() => {
                  const annotation = manifest?.annotations.find(
                    (candidate) => candidate.id === selectedAnnotationId,
                  );
                  if (!annotation) return null;
                  const update = (
                    changes: Partial<SceneAnnotation>,
                    persistence: AnnotationPersistence = 'immediate',
                  ) => updateAnnotation(annotation.id, changes, persistence);
                  return (
                    <>
                      <label className="editor-field">
                        <span>Title</span>
                        <input
                          key={`${annotation.id}-title`}
                          defaultValue={annotation.title}
                          onBlur={(event) => {
                            const title = event.currentTarget.value.trim();
                            if (!title) {
                              event.currentTarget.value = annotation.title;
                              return;
                            }
                            event.currentTarget.value = title;
                            if (title !== annotation.title) update({ title });
                          }}
                        />
                      </label>
                      <label className="editor-field">
                        <span>Description</span>
                        <textarea
                          key={`${annotation.id}-description`}
                          defaultValue={annotation.description}
                          onBlur={(event) => {
                            if (event.currentTarget.value !== annotation.description) {
                              update({ description: event.currentTarget.value });
                            }
                          }}
                        />
                      </label>
                      <label className="color-control">
                        <span>Color</span>
                        <input
                          type="color"
                          value={annotation.color}
                          onChange={(event) => update({ color: event.target.value })}
                        />
                      </label>
                      <fieldset className="nudge-group">
                        <legend>Label offset from circle (screen px)</legend>
                        {(['X', 'Y'] as const).map((axis, index) => (
                          <label className="transform-controls__row" key={axis}>
                            <span>{axis}</span>
                            <input
                              type="number"
                              step="1"
                              value={annotation.labelOffset[index]}
                              onChange={(event) => {
                                const value = Number(event.target.value);
                                if (!Number.isFinite(value)) return;
                                if (value === annotation.labelOffset[index]) return;
                                const labelOffset = [...annotation.labelOffset] as [
                                  number,
                                  number,
                                  0,
                                ];
                                labelOffset[index] = value;
                                labelOffset[2] = 0;
                                update({ labelOffset }, 'local');
                              }}
                              onBlur={saveAnnotations}
                            />
                          </label>
                        ))}
                      </fieldset>
                      <Toggle
                        label="Visible to investors"
                        checked={annotation.visibility === 'PUBLIC'}
                        disabled={sceneConflict}
                        onChange={(visible) =>
                          update({ visibility: visible ? 'PUBLIC' : 'PRIVATE' })
                        }
                      />
                      <button
                        className="secondary-button"
                        type="button"
                        onClick={() => deleteAnnotation(annotation.id)}
                      >
                        Delete annotation
                      </button>
                    </>
                  );
                })()
              ) : (
                <p className="panel__hint">
                  Add an annotation to edit its details and move its marker.
                </p>
              )}
            </section>
          ) : null}
        </aside>
        <section className="viewer-canvas-wrap">
          <canvas ref={canvasRef} className="viewer-canvas" aria-label="Persistent project scene" />
          {isSceneLoading ? <SceneLoadingOverlay /> : null}
          <SceneAnnotationLabels
            annotations={manifest?.annotations ?? []}
            positions={annotationLabelPositions}
            visible={editorVisibility.annotations}
          />
          <p className="viewer-canvas-wrap__help">
            Drag to orbit · scroll to zoom · right-drag to pan
          </p>
        </section>
      </div>
      <section className="investor-comments" aria-labelledby="investor-comments-title">
        <div className="investor-comments__header">
          <div>
            <h2 id="investor-comments-title">Investor comments</h2>
            <p className="panel__hint">Feedback left on shared annotation markers.</p>
          </div>
          <div className="auth-page__actions">
            <button
              className="secondary-button"
              type="button"
              disabled={
                isUpdatingComments || !annotationComments.some((comment) => !comment.readAt)
              }
              onClick={() => void acknowledgeAnnotationComments()}
            >
              Acknowledge seen
            </button>
            <button
              className="secondary-button"
              type="button"
              disabled={isUpdatingComments}
              onClick={() => void loadAnnotationComments()}
            >
              Refresh
            </button>
          </div>
        </div>
        {annotationComments.length ? (
          <ul className="annotation-comments">
            {annotationComments.map((comment) => (
              <li key={comment.id}>
                <div className="annotation-comments__heading">
                  <strong>
                    {(() => {
                      const annotation = manifest?.annotations.find(
                        (annotation) => annotation.id === comment.annotationId,
                      );
                      return annotation ? (
                        <button
                          className="annotation-comments__open"
                          type="button"
                          onClick={() => openCommentAnnotation(annotation.id)}
                        >
                          {annotation.title}
                        </button>
                      ) : (
                        'Deleted annotation'
                      );
                    })()}
                  </strong>
                  {!comment.readAt ? <span>New</span> : null}
                </div>
                <p>
                  {manifest?.annotations.some(
                    (annotation) => annotation.id === comment.annotationId,
                  ) ? (
                    <button
                      className="annotation-comments__open"
                      type="button"
                      onClick={() => openCommentAnnotation(comment.annotationId)}
                    >
                      {comment.body}
                    </button>
                  ) : (
                    comment.body
                  )}
                </p>
                <div className="annotation-comments__footer">
                  <small>
                    {comment.name} · {formatDate(comment.createdAt)}
                  </small>
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={isUpdatingComments}
                    onClick={() => void deleteAnnotationComment(comment)}
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="panel__hint">No investor comments yet.</p>
        )}
      </section>
    </section>
  );
}

function SceneAnnotationLabels({
  annotations,
  positions,
  visible,
}: {
  annotations: SceneAnnotation[];
  positions: AnnotationScreenPosition[];
  visible: boolean;
}) {
  const positionsById = new Map(positions.map((position) => [position.id, position]));
  if (!visible) return null;
  return (
    <div className="annotation-label-layer" aria-hidden="true">
      {annotations.map((annotation) => {
        const position = positionsById.get(annotation.id);
        if (!position?.visible) return null;
        return (
          <span
            className="annotation-screen-label"
            key={annotation.id}
            style={{
              left: `${position.x + annotation.labelOffset[0]}px`,
              top: `${position.y + annotation.labelOffset[1]}px`,
            }}
          >
            {annotation.title}
          </span>
        );
      })}
    </div>
  );
}

function ProjectAccess({ children }: PropsWithChildren) {
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

// Retained as the local Phase 2 proof harness; the product entry point now starts at sign-in.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function Viewer() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewerRef = useRef<HybridViewer | null>(null);
  const [viewerState, setViewerState] = useState<ViewerState>(INITIAL_VIEWER_STATE);
  const [environmentPosition, setEnvironmentPosition] = useState<Vector3>([0, 0, 0]);
  const [environmentRotation, setEnvironmentRotation] = useState<Vector3>([0, 0, 0]);
  const [environmentScale, setEnvironmentScale] = useState(1);
  const [positionRate, setPositionRate] = useState<Vector3>([0, 0, 0]);
  const [rotationRate, setRotationRate] = useState<Vector3>([0, 0, 0]);
  const [scaleRate, setScaleRate] = useState(0);
  const [nudgeSpeed, setNudgeSpeed] = useState<NudgeSpeed>('slow');
  const [environmentVisible, setEnvironmentVisible] = useState(true);
  const [buildingVisible, setBuildingVisible] = useState(true);

  const environmentTransform = useMemo(
    () =>
      createTransformFromEulerDegrees(environmentPosition, environmentRotation, environmentScale),
    [environmentPosition, environmentRotation, environmentScale],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    try {
      const viewer = new HybridViewer(canvas, {
        mobile: window.matchMedia('(max-width: 767px)').matches,
        onStateChange: setViewerState,
      });
      viewerRef.current = viewer;

      return () => {
        viewer.dispose();
        viewerRef.current = null;
      };
    } catch (error) {
      setViewerState({
        status: 'error',
        message: error instanceof Error ? error.message : 'WebGL viewer initialization failed.',
      });
    }
  }, []);

  useEffect(() => {
    viewerRef.current?.setEnvironmentTransform(environmentTransform);
  }, [environmentTransform]);

  useEffect(() => {
    if (![...positionRate, ...rotationRate, scaleRate].some((rate) => rate !== 0)) {
      return;
    }

    const positionUnitsPerSecond = nudgeSpeed === 'slow' ? 0.5 : 12;
    const rotationDegreesPerSecond = nudgeSpeed === 'slow' ? 12 : 180;
    const scaleUnitsPerSecond = nudgeSpeed === 'slow' ? 0.25 : 6;
    let previousFrame = performance.now();
    let frame = 0;

    const update = (now: number) => {
      const deltaSeconds = Math.min((now - previousFrame) / 1000, 0.1);
      previousFrame = now;

      setEnvironmentPosition((current) =>
        addRate(current, positionRate, positionUnitsPerSecond * deltaSeconds),
      );
      setEnvironmentRotation((current) =>
        addRate(current, rotationRate, rotationDegreesPerSecond * deltaSeconds),
      );
      setEnvironmentScale((current) =>
        Math.max(0.0001, current + scaleRate * scaleUnitsPerSecond * deltaSeconds),
      );
      frame = requestAnimationFrame(update);
    };

    frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  }, [nudgeSpeed, positionRate, rotationRate, scaleRate]);

  async function handleAssetFile(kind: AssetKind, event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    const viewer = viewerRef.current;
    event.currentTarget.value = '';

    if (!file || !viewer) {
      return;
    }

    try {
      if (kind === 'environment') {
        await viewer.loadEnvironment(file, environmentTransform);
      } else {
        await viewer.loadBuilding(file);
      }
    } catch (error) {
      setViewerState({
        status: 'error',
        message: error instanceof Error ? error.message : 'The selected file could not be loaded.',
      });
    }
  }

  function updateVector(
    setValue: (value: Vector3) => void,
    current: Vector3,
    index: number,
    rawValue: string,
  ) {
    const value = Number(rawValue);
    if (Number.isFinite(value)) {
      setValue(replaceAt(current, index, value));
    }
  }

  function updateScale(rawValue: string) {
    const value = Number(rawValue);
    if (Number.isFinite(value) && value > 0) {
      setEnvironmentScale(value);
    }
  }

  function updateVisibility(kind: AssetKind, visible: boolean) {
    viewerRef.current?.setVisible(kind, visible);
    if (kind === 'environment') {
      setEnvironmentVisible(visible);
    } else {
      setBuildingVisible(visible);
    }
  }

  return (
    <main className="viewer-app">
      <header className="viewer-app__header">
        <div>
          <p className="eyebrow">Phase 2 · local hybrid viewer</p>
          <h1>Gaussian Viewer</h1>
        </div>
        <AuthControls />
        <div className="viewer-app__status">
          <p className={`viewer-state viewer-state--${viewerState.status}`}>
            {viewerState.message}
          </p>
          {viewerState.warning ? <p className="viewer-warning">{viewerState.warning}</p> : null}
        </div>
      </header>

      <section className="viewer-layout" aria-label="Local hybrid viewer">
        <aside className="panel panel--controls">
          <section>
            <h2>Local assets</h2>
            <p className="panel__hint">
              Files stay in this browser session and are never uploaded.
            </p>
            <label className="file-input">
              <span>Environment (.ply or .spz)</span>
              <input
                type="file"
                accept=".ply,.spz"
                onChange={(event) => void handleAssetFile('environment', event)}
              />
            </label>
            <label className="file-input">
              <span>Building (.glb)</span>
              <input
                type="file"
                accept=".glb,model/gltf-binary"
                onChange={(event) => void handleAssetFile('building', event)}
              />
            </label>
          </section>

          <section>
            <h2>Visibility</h2>
            <Toggle
              label="Environment"
              checked={environmentVisible}
              onChange={(visible) => updateVisibility('environment', visible)}
            />
            <Toggle
              label="Building"
              checked={buildingVisible}
              onChange={(visible) => updateVisibility('building', visible)}
            />
          </section>

          <section>
            <div className="panel__section-heading">
              <h2>Environment alignment</h2>
              <label className="speed-select">
                <span>Nudge speed</span>
                <select
                  value={nudgeSpeed}
                  onChange={(event) => setNudgeSpeed(event.target.value as NudgeSpeed)}
                >
                  <option value="slow">Slow</option>
                  <option value="fast">Fast</option>
                </select>
              </label>
            </div>
            <p className="panel__hint">
              Hold a rate slider away from centre to nudge continuously. Its distance from centre
              sets the speed. Position is metres; rotation is Euler XYZ degrees.
            </p>
            <NudgeVector
              label="Position"
              values={environmentPosition}
              rates={positionRate}
              onValueChange={(index, value) =>
                updateVector(setEnvironmentPosition, environmentPosition, index, value)
              }
              onRateChange={(index, value) =>
                updateVector(setPositionRate, positionRate, index, value)
              }
            />
            <NudgeVector
              label="Rotation"
              values={environmentRotation}
              rates={rotationRate}
              unit="°"
              onValueChange={(index, value) =>
                updateVector(setEnvironmentRotation, environmentRotation, index, value)
              }
              onRateChange={(index, value) =>
                updateVector(setRotationRate, rotationRate, index, value)
              }
            />
            <NudgeScale
              value={environmentScale}
              rate={scaleRate}
              onValueChange={updateScale}
              onRateChange={(value) => setScaleRate(Number(value))}
            />
          </section>
        </aside>

        <section className="viewer-canvas-wrap">
          <canvas ref={canvasRef} className="viewer-canvas" aria-label="Three.js hybrid scene" />
          <p className="viewer-canvas-wrap__help">
            Drag to orbit · scroll to zoom · right-drag to pan
          </p>
        </section>
      </section>
    </main>
  );
}

function AuthControls() {
  const auth = useAuth();

  if (auth.status === 'loading') {
    return <p className="auth-controls">Checking session…</p>;
  }

  if (auth.status === 'authenticated') {
    return (
      <div className="auth-controls">
        <a href="/projects">Projects</a>
        <span>{auth.user?.displayName ?? auth.user?.email}</span>
        <button type="button" onClick={() => void auth.signOut()}>
          Sign out
        </button>
      </div>
    );
  }

  return (
    <div className="auth-controls">
      {auth.error ? <span className="auth-controls__error">{auth.error}</span> : null}
      <button type="button" onClick={() => void auth.signInWithGoogle()}>
        Sign in with Google
      </button>
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
  disabled = false,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="toggle">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

function TransformControls({
  kind,
  transform,
  disabled,
  onChange,
}: {
  kind: 'environment' | 'building';
  transform: Transform;
  disabled: boolean;
  onChange: (transform: Transform) => void;
}) {
  const rotation = transformToEulerDegrees(transform);

  function updatePosition(index: number, rawValue: string) {
    const value = Number(rawValue);
    if (Number.isFinite(value)) {
      onChange({ ...transform, position: replaceAt(transform.position, index, value) });
    }
  }

  function updateRotation(index: number, rawValue: string) {
    const value = Number(rawValue);
    if (!Number.isFinite(value)) return;
    const nextRotation = replaceAt(rotation, index, value);
    onChange(setTransformEulerDegrees(transform, nextRotation));
  }

  function updateScale(index: number, rawValue: string) {
    const value = Number(rawValue);
    if (!Number.isFinite(value) || value <= 0) return;
    onChange({
      ...transform,
      scale:
        kind === 'environment' ? [value, value, value] : replaceAt(transform.scale, index, value),
    });
  }

  return (
    <div className="transform-controls">
      <NumericVector
        label="Position"
        values={transform.position}
        disabled={disabled}
        onChange={updatePosition}
      />
      <NumericVector
        label="Rotation (°)"
        values={rotation}
        disabled={disabled}
        onChange={updateRotation}
      />
      {kind === 'environment' ? (
        <label className="transform-controls__scale">
          <span>Scale</span>
          <input
            type="number"
            min="0.0001"
            step="any"
            disabled={disabled}
            value={transform.scale[0]}
            onChange={(event) => updateScale(0, event.target.value)}
          />
        </label>
      ) : (
        <NumericVector
          label="Scale"
          values={transform.scale}
          disabled={disabled}
          min="0.0001"
          onChange={updateScale}
        />
      )}
    </div>
  );
}

function NumericVector({
  label,
  values,
  disabled,
  min,
  onChange,
}: {
  label: string;
  values: Vector3;
  disabled: boolean;
  min?: string;
  onChange: (index: number, rawValue: string) => void;
}) {
  return (
    <fieldset className="nudge-group">
      <legend>{label}</legend>
      {values.map((value, index) => (
        <label className="transform-controls__row" key={['X', 'Y', 'Z'][index]}>
          <span>{['X', 'Y', 'Z'][index]}</span>
          <input
            type="number"
            min={min}
            step="any"
            disabled={disabled}
            value={value}
            onChange={(event) => onChange(index, event.target.value)}
          />
        </label>
      ))}
    </fieldset>
  );
}

function NudgeVector({
  label,
  values,
  rates,
  unit,
  onValueChange,
  onRateChange,
}: {
  label: string;
  values: Vector3;
  rates: Vector3;
  unit?: string;
  onValueChange: (index: number, value: string) => void;
  onRateChange: (index: number, value: string) => void;
}) {
  return (
    <fieldset className="nudge-group">
      <legend>
        {label}
        {unit ? ` (${unit})` : ''}
      </legend>
      {values.map((value, index) => (
        <label className="nudge-row" key={['X', 'Y', 'Z'][index]}>
          <span>{['X', 'Y', 'Z'][index]}</span>
          <RateSlider rate={rates[index]!} onChange={(rate) => onRateChange(index, rate)} />
          <input
            type="number"
            step="any"
            value={value}
            onChange={(event) => onValueChange(index, event.target.value)}
          />
        </label>
      ))}
    </fieldset>
  );
}

function NudgeScale({
  value,
  rate,
  onValueChange,
  onRateChange,
}: {
  value: number;
  rate: number;
  onValueChange: (value: string) => void;
  onRateChange: (value: string) => void;
}) {
  return (
    <fieldset className="nudge-group">
      <legend>Global scale</legend>
      <label className="nudge-row">
        <span>All</span>
        <RateSlider rate={rate} onChange={onRateChange} />
        <input
          type="number"
          min="0.0001"
          step="any"
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
        />
      </label>
    </fieldset>
  );
}

function RateSlider({ rate, onChange }: { rate: number; onChange: (value: string) => void }) {
  const reset = () => onChange('0');

  return (
    <input
      className="nudge-rate"
      type="range"
      min="-1"
      max="1"
      step="0.01"
      value={rate}
      aria-label="Continuous nudge rate"
      onChange={(event) => onChange(event.target.value)}
      onPointerUp={reset}
      onPointerCancel={reset}
      onBlur={reset}
      onKeyUp={reset}
    />
  );
}

function replaceAt(vector: Vector3, index: number, value: number): Vector3 {
  return vector.map((item, itemIndex) => (itemIndex === index ? value : item)) as Vector3;
}

function transformsFromManifest(manifest: OwnerSceneManifest): TransformSnapshot {
  return {
    environment: cloneTransform(manifest.environmentTransform),
    building: manifest.variants[0] ? cloneTransform(manifest.variants[0].transform) : undefined,
  };
}

function cloneTransform(transform: Transform): Transform {
  return {
    position: [...transform.position] as Transform['position'],
    quaternion: [...transform.quaternion] as Transform['quaternion'],
    scale: [...transform.scale] as Transform['scale'],
  };
}

function cloneTransformSnapshot(snapshot: TransformSnapshot): TransformSnapshot {
  return {
    environment: cloneTransform(snapshot.environment),
    building: snapshot.building ? cloneTransform(snapshot.building) : undefined,
  };
}

function transformsMatch(left: TransformSnapshot, right: TransformSnapshot): boolean {
  return (
    left.environment.position.every(
      (value, index) => value === right.environment.position[index],
    ) &&
    left.environment.quaternion.every(
      (value, index) => value === right.environment.quaternion[index],
    ) &&
    left.environment.scale.every((value, index) => value === right.environment.scale[index]) &&
    transformsEqual(left.building, right.building)
  );
}

function transformsEqual(left: Transform | undefined, right: Transform | undefined): boolean {
  if (!left || !right) return left === right;
  return (
    left.position.every((value, index) => value === right.position[index]) &&
    left.quaternion.every((value, index) => value === right.quaternion[index]) &&
    left.scale.every((value, index) => value === right.scale[index])
  );
}

function transformToEulerDegrees(transform: Transform): Vector3 {
  return getTransformEulerDegrees(transform);
}

function addRate(vector: Vector3, rate: Vector3, delta: number): Vector3 {
  return [vector[0] + rate[0] * delta, vector[1] + rate[1] * delta, vector[2] + rate[2] * delta];
}

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong.';
}

async function sha256Base64(file: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  const bytes = new Uint8Array(digest);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function multipartStorageKey(
  projectId: string,
  file: Pick<File, 'name' | 'size' | 'lastModified'>,
): string {
  return `gaussian-viewer:multipart:${projectId}:${file.name}:${file.size}:${file.lastModified}`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value),
  );
}

function formatAssetStatus(status: ProjectSummary['assetStatus']): string {
  if (status === 'NO_ASSETS') return 'No assets';
  return status === 'ASSETS_READY' ? 'Files ready' : 'Files processing';
}

function formatShareStatus(status: ProjectSummary['shareStatus']): string {
  return status === 'NOT_SHARED' ? 'Not shared' : status;
}

function runtimeFilename(kind: 'environment' | 'building', format: PublicAssetFormat): string {
  return `${kind}.${format.toLowerCase()}`;
}

function shareUrl(token: string): string {
  return `${window.location.origin}/share/${token}`;
}
