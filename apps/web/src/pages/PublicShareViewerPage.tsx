import type { FormEvent } from 'react';
import { useEffect, useRef, useState } from 'react';
import type {
  PublicAssetFormat,
  PublicAnnotationComment,
  PublicShareManifest,
  SceneAnnotation,
} from '@gaussian-viewer/contracts';
import { HybridViewer, type AnnotationScreenPosition } from '@gaussian-viewer/viewer-core';
import { SceneLoadingOverlay } from '../components/viewer/SceneLoadingOverlay.js';
import { messageFor } from '../lib/format.js';

type PublicViewerVisibility = {
  environment: boolean;
  building: boolean;
  sky: boolean;
  annotations: boolean;
};

export function PublicShareViewerPage({ token }: { token: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewerRef = useRef<HybridViewer | null>(null);
  const manifestRef = useRef<PublicShareManifest | null>(null);
  const [manifest, setManifest] = useState<PublicShareManifest | null>(null);
  const [message, setMessage] = useState('Loading shared project…');
  const [error, setError] = useState<string | null>(null);
  const [isSceneLoading, setIsSceneLoading] = useState(true);
  const [selectedAnnotation, setSelectedAnnotation] = useState<SceneAnnotation | null>(null);
  const [annotationComments, setAnnotationComments] = useState<PublicAnnotationComment[]>([]);
  const [commentHistoryStatus, setCommentHistoryStatus] = useState<string | null>(null);
  const [investorName, setInvestorName] = useState(readInvestorNameCookie);
  const [comment, setComment] = useState('');
  const [commentStatus, setCommentStatus] = useState<string | null>(null);
  const [annotationLabelPositions, setAnnotationLabelPositions] = useState<
    AnnotationScreenPosition[]
  >([]);
  const [viewerVisibility, setViewerVisibility] = useState<PublicViewerVisibility>({
    environment: true,
    building: true,
    sky: true,
    annotations: true,
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const viewer = new HybridViewer(canvas, {
      mobile: window.matchMedia('(max-width: 767px)').matches,
      onAnnotationClick: (annotationId) => {
        const annotation = manifestRef.current?.annotations.find(
          (candidate) => candidate.id === annotationId,
        );
        if (annotation) {
          void selectAnnotation(annotation);
        }
      },
      onStateChange: (state) => setMessage(state.message ?? 'Loading shared project…'),
    });
    viewer.selectAsset(undefined);
    viewer.setAnnotations([]);
    viewerRef.current = viewer;
    return () => {
      viewer.dispose();
      viewerRef.current = null;
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
    let active = true;
    void (async () => {
      try {
        setIsSceneLoading(true);
        setError(null);
        const response = await fetch(`/api/public/shares/${encodeURIComponent(token)}/manifest`, {
          cache: 'no-store',
          referrerPolicy: 'no-referrer',
        });
        if (!response.ok)
          throw new Error('This shared project is unavailable or its link has expired.');
        const loaded = (await response.json()) as PublicShareManifest;
        const viewer = viewerRef.current;
        if (!active || !viewer) return;
        viewer.setSkyVisible(loaded.viewerSettings.sky.visible);
        viewer.setSkyRotation(loaded.viewerSettings.sky.rotationYDegrees);
        viewer.setSunPower(loaded.viewerSettings.lighting.sun.power);
        viewer.setSunColor(loaded.viewerSettings.lighting.sun.color);
        viewer.setSunRotation(loaded.viewerSettings.lighting.sun.rotationDegrees);
        viewer.setAmbientPower(loaded.viewerSettings.lighting.ambient.power);
        viewer.setAmbientColor(loaded.viewerSettings.lighting.ambient.color);
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
        viewer.setAnnotations(loaded.annotations, loaded.annotationScale);
        viewer.setAnnotationsVisible(loaded.annotations.length > 0);
        if (loaded.defaultCamera) viewer.setCamera(loaded.defaultCamera);
        document.title = `${loaded.project.name} — Gaussian Viewer`;
        if (active) {
          manifestRef.current = loaded;
          setViewerVisibility({
            environment: loaded.viewerSettings.environmentVisible,
            building: Boolean(building?.visible) && loaded.viewerSettings.buildingVisible,
            sky: loaded.viewerSettings.sky.visible,
            annotations: loaded.annotations.length > 0,
          });
          setManifest(loaded);
        }
      } catch (loadError) {
        if (active) setError(messageFor(loadError));
      } finally {
        if (active) setIsSceneLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [token]);

  async function selectAnnotation(
    annotation: SceneAnnotation,
    clearCommentStatus = true,
  ): Promise<void> {
    setSelectedAnnotation(annotation);
    if (clearCommentStatus) setCommentStatus(null);
    setAnnotationComments([]);
    setCommentHistoryStatus('Loading previous comments…');
    try {
      const response = await fetch(
        `/api/public/shares/${encodeURIComponent(token)}/annotations/${encodeURIComponent(annotation.id)}/comments`,
        { cache: 'no-store', referrerPolicy: 'no-referrer' },
      );
      if (!response.ok) throw new Error('Previous comments could not be loaded.');
      const history = (await response.json()) as PublicAnnotationComment[];
      setAnnotationComments(history);
      setCommentHistoryStatus(null);
    } catch (historyError) {
      setCommentHistoryStatus(messageFor(historyError));
    }
  }

  async function submitComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = investorName.trim();
    if (!selectedAnnotation || !name || !comment.trim()) return;
    try {
      setCommentStatus('Sending...');
      const response = await fetch(
        `/api/public/shares/${encodeURIComponent(token)}/annotations/${encodeURIComponent(selectedAnnotation.id)}/comments`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name, body: comment }),
          cache: 'no-store',
          referrerPolicy: 'no-referrer',
        },
      );
      if (!response.ok) throw new Error('Your comment could not be sent.');
      writeInvestorNameCookie(name);
      setComment('');
      setCommentStatus('Comment sent to the project owner.');
      void selectAnnotation(selectedAnnotation, false);
    } catch (submitError) {
      setCommentStatus(messageFor(submitError));
    }
  }

  function updateViewerVisibility(kind: keyof PublicViewerVisibility, visible: boolean) {
    setViewerVisibility((current) => ({ ...current, [kind]: visible }));
    if (kind === 'annotations') {
      viewerRef.current?.setAnnotationsVisible(visible);
    } else if (kind === 'sky') {
      viewerRef.current?.setSkyVisible(visible);
    } else {
      viewerRef.current?.setVisible(kind, visible);
    }
  }

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
        <div className="public-viewer__visibility" aria-label="Scene visibility">
          {(['environment', 'building', 'sky', 'annotations'] as const).map((kind) => (
            <label className="toggle" key={kind}>
              <input
                type="checkbox"
                checked={viewerVisibility[kind]}
                onChange={(event) => updateViewerVisibility(kind, event.target.checked)}
              />
              {kind.charAt(0).toUpperCase() + kind.slice(1)}
            </label>
          ))}
        </div>
      </header>
      {error ? (
        <section className="public-viewer__error">
          <h2>Shared project unavailable</h2>
          <p>{error}</p>
        </section>
      ) : (
        <section className="public-viewer__canvas">
          <canvas ref={canvasRef} className="viewer-canvas" aria-label="Shared project scene" />
          {isSceneLoading ? <SceneLoadingOverlay label="Loading shared project assets…" /> : null}
          <AnnotationLabels
            annotations={manifest?.annotations ?? []}
            positions={annotationLabelPositions}
            visible={viewerVisibility.annotations}
          />
          {selectedAnnotation ? (
            <aside
              className="annotation-overlay"
              aria-label={`Annotation: ${selectedAnnotation.title}`}
            >
              <button
                className="annotation-overlay__close"
                type="button"
                aria-label="Close annotation"
                onClick={() => setSelectedAnnotation(null)}
              >
                Close
              </button>
              <h2>{selectedAnnotation.title}</h2>
              {selectedAnnotation.description ? <p>{selectedAnnotation.description}</p> : null}
              <section className="annotation-comment-history" aria-label="Previous comments">
                <h3>Previous comments</h3>
                {commentHistoryStatus ? <p role="status">{commentHistoryStatus}</p> : null}
                {!commentHistoryStatus && annotationComments.length ? (
                  <ul className="annotation-comments">
                    {annotationComments.map((previousComment) => (
                      <li key={previousComment.id}>
                        <strong>{previousComment.name}</strong>
                        <p>{previousComment.body}</p>
                        <small>{formatCommentDate(previousComment.createdAt)}</small>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {!commentHistoryStatus && annotationComments.length === 0 ? (
                  <p>No comments yet.</p>
                ) : null}
              </section>
              <form onSubmit={(event) => void submitComment(event)}>
                <label>
                  Your name
                  <input
                    required
                    maxLength={120}
                    value={investorName}
                    onChange={(event) => setInvestorName(event.target.value)}
                    onBlur={() => {
                      const name = investorName.trim();
                      if (name) writeInvestorNameCookie(name);
                    }}
                  />
                </label>
                <label>
                  Comment for the owner
                  <textarea
                    required
                    maxLength={2000}
                    value={comment}
                    onChange={(event) => setComment(event.target.value)}
                  />
                </label>
                <button className="auth-button" type="submit">
                  Send comment
                </button>
              </form>
              {commentStatus ? <p role="status">{commentStatus}</p> : null}
            </aside>
          ) : null}
          <p className="viewer-canvas-wrap__help">
            Drag to orbit · scroll to zoom · right-drag to pan
          </p>
        </section>
      )}
    </main>
  );
}

function AnnotationLabels({
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

function runtimeFilename(kind: 'environment' | 'building', format: PublicAssetFormat): string {
  return `${kind}.${format.toLowerCase()}`;
}

function readInvestorNameCookie(): string {
  const prefix = 'gaussian_viewer_investor_name=';
  const cookie = document.cookie.split('; ').find((entry) => entry.startsWith(prefix));
  if (!cookie) return '';
  try {
    return decodeURIComponent(cookie.slice(prefix.length));
  } catch {
    return '';
  }
}

function writeInvestorNameCookie(name: string): void {
  document.cookie = `gaussian_viewer_investor_name=${encodeURIComponent(name)}; Path=/; Max-Age=31536000; SameSite=Lax`;
}

function formatCommentDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value),
  );
}
