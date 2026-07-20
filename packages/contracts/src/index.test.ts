import { expect, test } from 'vitest';
import {
  CreateAnnotationCommentInputSchema,
  migrateViewerSettings,
  SceneAnnotationSchema,
  SceneManifestSchema,
} from './index.js';

test('accepts a minimal scene manifest', () => {
  const manifest = SceneManifestSchema.parse({
    id: 'scene-1',
    projectId: 'project-1',
    revision: 0,
    variants: [],
    viewerSettings: { schemaVersion: 3, environmentVisible: true, buildingVisible: true },
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
    viewerSettings: { schemaVersion: 3, environmentVisible: true, buildingVisible: true },
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
    viewerSettings: { schemaVersion: 3, environmentVisible: true, buildingVisible: true },
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
    viewerSettings: { schemaVersion: 3, environmentVisible: true, buildingVisible: true },
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
    schemaVersion: 3,
    environmentVisible: false,
    buildingVisible: true,
    sky: { visible: true, rotationYDegrees: 0 },
    lighting: {
      sun: { power: 2.5, color: '#ffffff', rotationDegrees: [0, 0, 0] },
      ambient: { power: 1.8, color: '#ffffff' },
    },
  });
  expect(migrateViewerSettings({ schemaVersion: 1 })).toEqual({
    schemaVersion: 3,
    environmentVisible: true,
    buildingVisible: true,
    sky: { visible: true, rotationYDegrees: 0 },
    lighting: {
      sun: { power: 2.5, color: '#ffffff', rotationDegrees: [0, 0, 0] },
      ambient: { power: 1.8, color: '#ffffff' },
    },
  });
  expect(migrateViewerSettings({ schemaVersion: 2 })).toEqual({
    schemaVersion: 3,
    environmentVisible: true,
    buildingVisible: true,
    sky: { visible: true, rotationYDegrees: 0 },
    lighting: {
      sun: { power: 2.5, color: '#ffffff', rotationDegrees: [0, 0, 0] },
      ambient: { power: 1.8, color: '#ffffff' },
    },
  });
  expect(() => migrateViewerSettings({ schemaVersion: 4 })).toThrow();
});

test('validates durable annotation details and bounded investor comments', () => {
  expect(
    SceneAnnotationSchema.parse({
      id: 'annotation-1',
      position: [1, 2, 3],
      title: 'Arrival',
      description: 'Entry sequence',
      visibility: 'PUBLIC',
    }),
  ).toMatchObject({ color: '#78b8f6', labelOffset: [16, -8, 0] });
  expect(
    CreateAnnotationCommentInputSchema.safeParse({ name: 'Investor', body: ' '.repeat(1) }).success,
  ).toBe(false);
  expect(
    CreateAnnotationCommentInputSchema.safeParse({ name: 'Investor', body: 'Useful detail.' })
      .success,
  ).toBe(true);
  expect(CreateAnnotationCommentInputSchema.safeParse({ body: 'Useful detail.' }).success).toBe(
    false,
  );
});
