import { useEffect, useRef, useState } from 'react';
import type { PublicAssetFormat, PublicShareManifest } from '@gaussian-viewer/contracts';
import { HybridViewer } from '@gaussian-viewer/viewer-core';
import { messageFor } from '../lib/format.js';

export function PublicShareViewerPage({ token }: { token: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewerRef = useRef<HybridViewer | null>(null);
  const [manifest, setManifest] = useState<PublicShareManifest | null>(null);
  const [message, setMessage] = useState('Loading shared project…');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const viewer = new HybridViewer(canvas, {
      mobile: window.matchMedia('(max-width: 767px)').matches,
      onStateChange: (state) => setMessage(state.message ?? 'Loading shared project…'),
    });
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
        if (!response.ok)
          throw new Error('This shared project is unavailable or its link has expired.');
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
        document.title = `${loaded.project.name} — Gaussian Viewer`;
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
            Drag to orbit · scroll to zoom · right-drag to pan
          </p>
        </section>
      )}
    </main>
  );
}

function runtimeFilename(kind: 'environment' | 'building', format: PublicAssetFormat): string {
  return `${kind}.${format.toLowerCase()}`;
}
