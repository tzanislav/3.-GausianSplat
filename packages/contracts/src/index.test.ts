import { expect, test } from 'vitest';
import { migrateViewerSettings, SceneManifestSchema } from './index.js';

test('accepts a minimal scene manifest', () => {
  const manifest = SceneManifestSchema.parse({
    id: 'scene-1',
    projectId: 'project-1',
    revision: 0,
    variants: [],
    viewerSettings: { schemaVersion: 1, environmentVisible: true, buildingVisible: true },
    defaultCamera: null,
    annotations: [],
    environmentTransform: {
      position: [0, 0, 0],
      quaternion: [0, 0, 0, 1],
      scale: [1, 1, 1],
    },
  });

  expect(manifest.revision).toBe(0);
});

test('rejects non-positive transform scale', () => {
  const result = SceneManifestSchema.safeParse({
    id: 'scene-1',
    projectId: 'project-1',
    revision: 0,
    variants: [],
    viewerSettings: { schemaVersion: 1, environmentVisible: true, buildingVisible: true },
    defaultCamera: null,
    annotations: [],
    environmentTransform: {
      position: [0, 0, 0],
      quaternion: [0, 0, 0, 1],
      scale: [0, 1, 1],
    },
  });

  expect(result.success).toBe(false);
});

test('rejects an uploaded asset from a scene manifest', () => {
  const result = SceneManifestSchema.safeParse({
    id: 'scene-1',
    projectId: 'project-1',
    revision: 0,
    variants: [],
    viewerSettings: { schemaVersion: 1, environmentVisible: true, buildingVisible: true },
    defaultCamera: null,
    annotations: [],
    environment: { id: 'asset-1', kind: 'ENVIRONMENT', state: 'UPLOADED' },
    environmentTransform: {
      position: [0, 0, 0],
      quaternion: [0, 0, 0, 1],
      scale: [1, 1, 1],
    },
  });

  expect(result.success).toBe(false);
});

test('limits the Phase 8 scene to one building variant', () => {
  const result = SceneManifestSchema.safeParse({
    id: 'scene-1',
    projectId: 'project-1',
    revision: 0,
    variants: [
      {
        id: 'variant-1',
        assetId: 'asset-1',
        name: 'One',
        transform: {
          position: [0, 0, 0],
          quaternion: [0, 0, 0, 1],
          scale: [1, 1, 1],
        },
        visible: true,
        displayOrder: 0,
      },
      {
        id: 'variant-2',
        assetId: 'asset-2',
        name: 'Two',
        transform: {
          position: [0, 0, 0],
          quaternion: [0, 0, 0, 1],
          scale: [1, 1, 1],
        },
        visible: true,
        displayOrder: 1,
      },
    ],
    viewerSettings: { schemaVersion: 1, environmentVisible: true, buildingVisible: true },
    defaultCamera: null,
    annotations: [],
    environmentTransform: {
      position: [0, 0, 0],
      quaternion: [0, 0, 0, 1],
      scale: [1, 1, 1],
    },
  });

  expect(result.success).toBe(false);
});

test('migrates pre-versioned viewer settings and rejects unsupported versions', () => {
  expect(migrateViewerSettings({ environmentVisible: false })).toEqual({
    schemaVersion: 1,
    environmentVisible: false,
    buildingVisible: true,
  });
  expect(migrateViewerSettings({ schemaVersion: 2, sky: { visible: false } })).toEqual({
    schemaVersion: 1,
    environmentVisible: true,
    buildingVisible: true,
  });
  expect(() => migrateViewerSettings({ schemaVersion: 3 })).toThrow();
});
