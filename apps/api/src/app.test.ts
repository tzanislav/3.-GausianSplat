import type { Server } from 'node:http';
import type { TokenVerifier } from '@gaussian-viewer/auth';
import type { AssetRecord, AssetUploadTicket, ShareLink } from '@gaussian-viewer/contracts';
import type {
  AssetRepository,
  ProjectRepository,
  SceneRecord,
  SceneRepository,
  ShareLinkRepository,
  UserRepository,
} from '@gaussian-viewer/database';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { createHash } from 'node:crypto';
import { createApp } from './app.js';
import type { AssetStorage } from './storage.js';

let server: Server;
let origin: string;

beforeAll(async () => {
  server = createApp().listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();

  if (!address || typeof address === 'string') {
    throw new Error('Test server did not expose a TCP address.');
  }

  origin = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

test('GET /health returns the API health payload', async () => {
  const response = await fetch(`${origin}/health`);

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({ status: 'ok' });
});

test('GET /auth/me reports when authentication is not configured', async () => {
  const response = await fetch(`${origin}/auth/me`);

  expect(response.status).toBe(503);
});

test('GET /auth/me verifies a token and upserts its Firebase user', async () => {
  const verifier: TokenVerifier = {
    async verifyIdToken(token) {
      if (token !== 'valid-token') {
        throw new Error('invalid token');
      }
      return {
        firebaseUid: 'firebase-user-id',
        email: 'owner@example.com',
        displayName: 'Owner',
        photoUrl: null,
      };
    },
  };
  const users: UserRepository = {
    async upsertFirebaseUser(user) {
      return {
        id: 'local-user-id',
        ...user,
        createdAt: '2026-07-18T00:00:00.000Z',
        updatedAt: '2026-07-18T00:00:00.000Z',
      };
    },
  };
  const authenticatedApp = createApp({ tokenVerifier: verifier, users });
  const authenticatedServer = authenticatedApp.listen(0);
  await new Promise<void>((resolve) => authenticatedServer.once('listening', resolve));
  const address = authenticatedServer.address();
  if (!address || typeof address === 'string') {
    throw new Error('Test server did not expose a TCP address.');
  }

  try {
    const missingTokenResponse = await fetch(`http://127.0.0.1:${address.port}/auth/me`);
    expect(missingTokenResponse.status).toBe(401);

    const response = await fetch(`http://127.0.0.1:${address.port}/auth/me`, {
      headers: { authorization: 'Bearer valid-token' },
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      firebaseUid: 'firebase-user-id',
      id: 'local-user-id',
    });
  } finally {
    await new Promise<void>((resolve, reject) => {
      authenticatedServer.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test('project endpoints scope data to the authenticated owner', async () => {
  const verifier: TokenVerifier = {
    async verifyIdToken(token) {
      if (token === 'owner-token') {
        return {
          firebaseUid: 'owner-id',
          email: 'owner@example.com',
          displayName: 'Owner',
          photoUrl: null,
        };
      }
      if (token === 'other-token') {
        return {
          firebaseUid: 'other-id',
          email: 'other@example.com',
          displayName: 'Other',
          photoUrl: null,
        };
      }
      throw new Error('invalid token');
    },
  };
  const users: UserRepository = {
    async upsertFirebaseUser(user) {
      return {
        id: user.firebaseUid,
        ...user,
        createdAt: '2026-07-18T00:00:00.000Z',
        updatedAt: '2026-07-18T00:00:00.000Z',
      };
    },
  };
  const projects: ProjectRepository = {
    async listOwnedProjects(ownerFirebaseUid) {
      return ownerFirebaseUid === 'owner-id'
        ? [projectSummary('owner-project', 'Owner project')]
        : [];
    },
    async createProject(ownerFirebaseUid, input) {
      return projectSummary(`${ownerFirebaseUid}-project`, input.name);
    },
    async getProject(projectId) {
      if (projectId === 'other-project') {
        return { ...projectSummary(projectId, 'Other project'), ownerFirebaseUid: 'other-id' };
      }
      if (projectId === 'owner-project') {
        return { ...projectSummary(projectId, 'Owner project'), ownerFirebaseUid: 'owner-id' };
      }
      return null;
    },
    async updateProject(projectId, input) {
      return projectSummary(projectId, input.name);
    },
    async archiveProject(projectId) {
      return {
        ...projectSummary(projectId, 'Owner project'),
        archivedAt: '2026-07-18T02:00:00.000Z',
      };
    },
    async deleteProject() {
      return true;
    },
  };
  const projectServer = createApp({ tokenVerifier: verifier, users, projects }).listen(0);
  await new Promise<void>((resolve) => projectServer.once('listening', resolve));
  const address = projectServer.address();
  if (!address || typeof address === 'string') {
    throw new Error('Test server did not expose a TCP address.');
  }
  const projectOrigin = `http://127.0.0.1:${address.port}`;

  try {
    const list = await fetch(`${projectOrigin}/projects`, {
      headers: { authorization: 'Bearer owner-token' },
    });
    expect(list.status).toBe(200);
    await expect(list.json()).resolves.toMatchObject([{ id: 'owner-project' }]);

    const create = await fetch(`${projectOrigin}/projects`, {
      method: 'POST',
      headers: { authorization: 'Bearer owner-token', 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'New project' }),
    });
    expect(create.status).toBe(201);
    await expect(create.json()).resolves.toMatchObject({ name: 'New project' });

    const invalid = await fetch(`${projectOrigin}/projects`, {
      method: 'POST',
      headers: { authorization: 'Bearer owner-token', 'content-type': 'application/json' },
      body: JSON.stringify({ name: '' }),
    });
    expect(invalid.status).toBe(400);

    const forbidden = await fetch(`${projectOrigin}/projects/other-project`, {
      headers: { authorization: 'Bearer owner-token' },
    });
    expect(forbidden.status).toBe(403);

    const update = await fetch(`${projectOrigin}/projects/owner-project`, {
      method: 'PATCH',
      headers: { authorization: 'Bearer owner-token', 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Renamed project' }),
    });
    expect(update.status).toBe(200);
    await expect(update.json()).resolves.toMatchObject({ name: 'Renamed project' });
  } finally {
    await new Promise<void>((resolve, reject) => {
      projectServer.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test('asset upload URLs are owner-scoped and assets are ready only after S3 validation', async () => {
  const verifier: TokenVerifier = {
    async verifyIdToken(token) {
      if (token !== 'owner-token') {
        throw new Error('invalid token');
      }
      return {
        firebaseUid: 'owner-id',
        email: 'owner@example.com',
        displayName: 'Owner',
        photoUrl: null,
      };
    },
  };
  const users: UserRepository = {
    async upsertFirebaseUser(user) {
      return {
        id: user.firebaseUid,
        ...user,
        createdAt: '2026-07-18T00:00:00.000Z',
        updatedAt: '2026-07-18T00:00:00.000Z',
      };
    },
  };
  const projects: ProjectRepository = {
    async listOwnedProjects() {
      return [];
    },
    async createProject(_ownerFirebaseUid, input) {
      return projectSummary('owner-project', input.name);
    },
    async getProject(projectId) {
      return projectId === 'owner-project'
        ? { ...projectSummary(projectId, 'Owner project'), ownerFirebaseUid: 'owner-id' }
        : null;
    },
    async updateProject() {
      return null;
    },
    async archiveProject() {
      return null;
    },
    async deleteProject() {
      return true;
    },
  };
  let stored: (AssetRecord & { ownerFirebaseUid: string; originalKey: string }) | undefined;
  let issuedKey: string | undefined;
  const assets: AssetRepository = {
    async createAsset(ownerFirebaseUid, projectId, asset) {
      stored = {
        id: 'asset-1',
        projectId,
        ...asset,
        state: 'CREATED',
        failureReason: null,
        createdAt: '2026-07-18T00:00:00.000Z',
        updatedAt: '2026-07-18T00:00:00.000Z',
        deletedAt: null,
        ownerFirebaseUid,
        originalKey: '',
      };
      return stored;
    },
    async setAssetOriginalKey(assetId, originalKey) {
      if (!stored || stored.id !== assetId) {
        return false;
      }
      stored.originalKey = originalKey;
      return true;
    },
    async getAsset(assetId) {
      return stored?.id === assetId ? stored : null;
    },
    async updateAssetState(assetId, expectedStates, state, failureReason = null) {
      if (!stored || stored.id !== assetId || !expectedStates.includes(stored.state)) {
        return null;
      }
      stored.state = state;
      stored.failureReason = failureReason;
      stored.deletedAt = state === 'DELETED' ? '2026-07-18T00:01:00.000Z' : null;
      return stored;
    },
  };
  const storage: AssetStorage = {
    async createUploadUrl({ key }) {
      issuedKey = key;
      return 'https://storage.example/upload';
    },
    async createDownloadUrl() {
      return 'https://storage.example/download';
    },
    async getObjectMetadata() {
      return { contentLength: 12, checksumSha256: `${'A'.repeat(43)}=` };
    },
    async getObjectHeader() {
      return new Uint8Array([0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0, 12, 0, 0, 0]);
    },
    async createMultipartUpload() {
      return 's3-upload-id';
    },
    async createMultipartPartUrl() {
      return 'https://storage.example/upload-part';
    },
    async completeMultipartUpload() {},
    async abortMultipartUpload() {},
  };
  const assetServer = createApp({
    tokenVerifier: verifier,
    users,
    projects,
    assets,
    storage,
  }).listen(0);
  await new Promise<void>((resolve) => assetServer.once('listening', resolve));
  const address = assetServer.address();
  if (!address || typeof address === 'string') {
    throw new Error('Test server did not expose a TCP address.');
  }
  const assetOrigin = `http://127.0.0.1:${address.port}`;

  try {
    const start = await fetch(`${assetOrigin}/projects/owner-project/assets/uploads`, {
      method: 'POST',
      headers: { authorization: 'Bearer owner-token', 'content-type': 'application/json' },
      body: JSON.stringify({
        kind: 'BUILDING',
        filename: '../building.glb',
        size: 12,
        checksumSha256: `${'A'.repeat(43)}=`,
      }),
    });
    expect(start.status).toBe(201);
    const ticket = (await start.json()) as AssetUploadTicket;
    expect(ticket).toMatchObject({
      assetId: 'asset-1',
      state: 'UPLOADING',
      uploadUrl: 'https://storage.example/upload',
      headers: {
        'content-type': 'model/gltf-binary',
        'x-amz-checksum-sha256': `${'A'.repeat(43)}=`,
      },
    });
    expect(issuedKey).toBe('projects/owner-project/assets/asset-1/original/building.glb');

    const complete = await fetch(`${assetOrigin}/projects/owner-project/assets/asset-1/complete`, {
      method: 'POST',
      headers: { authorization: 'Bearer owner-token' },
    });
    expect(complete.status).toBe(200);
    await expect(complete.json()).resolves.toMatchObject({ state: 'READY' });

    const download = await fetch(`${assetOrigin}/projects/owner-project/assets/asset-1/download`, {
      headers: { authorization: 'Bearer owner-token' },
    });
    expect(download.status).toBe(200);
    await expect(download.json()).resolves.toMatchObject({
      url: 'https://storage.example/download',
    });

    const deleted = await fetch(`${assetOrigin}/projects/owner-project/assets/asset-1`, {
      method: 'DELETE',
      headers: { authorization: 'Bearer owner-token' },
    });
    expect(deleted.status).toBe(204);
    expect(stored?.state).toBe('DELETED');
  } finally {
    await new Promise<void>((resolve, reject) => {
      assetServer.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test('scene manifests resolve private environment keys and scene updates reject stale revisions', async () => {
  const verifier: TokenVerifier = {
    async verifyIdToken(token) {
      if (token !== 'owner-token') throw new Error('invalid token');
      return {
        firebaseUid: 'owner-id',
        email: 'owner@example.com',
        displayName: 'Owner',
        photoUrl: null,
      };
    },
  };
  const users: UserRepository = {
    async upsertFirebaseUser(user) {
      return {
        id: user.firebaseUid,
        ...user,
        createdAt: '2026-07-18T00:00:00.000Z',
        updatedAt: '2026-07-18T00:00:00.000Z',
      };
    },
  };
  const projects: ProjectRepository = {
    async listOwnedProjects() {
      return [];
    },
    async createProject(_ownerFirebaseUid, input) {
      return projectSummary('owner-project', input.name);
    },
    async getProject(projectId) {
      return projectId === 'owner-project'
        ? { ...projectSummary(projectId, 'Owner project'), ownerFirebaseUid: 'owner-id' }
        : null;
    },
    async updateProject() {
      return null;
    },
    async archiveProject() {
      return null;
    },
    async deleteProject() {
      return true;
    },
  };
  let scene: SceneRecord = {
    id: 'scene-1',
    projectId: 'owner-project',
    ownerFirebaseUid: 'owner-id',
    revision: 3,
    environmentAssetId: 'environment-1',
    environmentTransform: {
      position: [0, 0, 0],
      quaternion: [0, 0, 0, 1],
      scale: [1, 1, 1],
    },
    variants: [],
    viewerSettings: {
      schemaVersion: 2,
      environmentVisible: true,
      buildingVisible: true,
      sky: { visible: true, rotationYDegrees: 0 },
    },
    defaultCamera: null,
    createdAt: '2026-07-18T00:00:00.000Z',
    updatedAt: '2026-07-18T00:00:00.000Z',
  };
  const scenes: SceneRepository = {
    async getScene(projectId) {
      return projectId === scene.projectId ? scene : null;
    },
    async updateScene(projectId, input) {
      if (projectId !== scene.projectId) return null;
      if (input.revision !== scene.revision) return 'STALE';
      scene = {
        ...scene,
        revision: scene.revision + 1,
        environmentAssetId: input.environmentAssetId,
        environmentTransform: input.environmentTransform,
        variants: input.variants,
        viewerSettings: input.viewerSettings,
        defaultCamera: input.defaultCamera,
      };
      return scene;
    },
  };
  const assets: AssetRepository = {
    async createAsset() {
      return null;
    },
    async setAssetOriginalKey() {
      return false;
    },
    async getAsset(assetId) {
      if (assetId === 'environment-1') {
        return {
          id: 'environment-1',
          projectId: 'owner-project',
          kind: 'ENVIRONMENT',
          state: 'READY',
          filename: 'site.spz',
          contentType: 'application/octet-stream',
          size: 128,
          checksumSha256: null,
          failureReason: null,
          createdAt: '2026-07-18T00:00:00.000Z',
          updatedAt: '2026-07-18T00:00:00.000Z',
          deletedAt: null,
          ownerFirebaseUid: 'owner-id',
          originalKey: 'projects/owner-project/assets/environment-1/original/site.spz',
        };
      }
      if (assetId === 'building-1') {
        return {
          id: 'building-1',
          projectId: 'owner-project',
          kind: 'BUILDING' as const,
          state: 'READY' as const,
          filename: 'building.glb',
          contentType: 'model/gltf-binary',
          size: 128,
          checksumSha256: null,
          failureReason: null,
          createdAt: '2026-07-18T00:00:00.000Z',
          updatedAt: '2026-07-18T00:00:00.000Z',
          deletedAt: null,
          ownerFirebaseUid: 'owner-id',
          originalKey: 'projects/owner-project/assets/building-1/original/building.glb',
        };
      }
      return null;
    },
    async updateAssetState() {
      return null;
    },
  };
  let resolvedKey: string | undefined;
  const storage: AssetStorage = {
    async createUploadUrl() {
      return 'https://storage.example/upload';
    },
    async createDownloadUrl(key) {
      resolvedKey = key;
      return 'https://storage.example/temporary-download';
    },
    async getObjectMetadata() {
      return { contentLength: 128, checksumSha256: `${'A'.repeat(43)}=` };
    },
    async getObjectHeader() {
      return new Uint8Array();
    },
    async createMultipartUpload() {
      return 'upload-id';
    },
    async createMultipartPartUrl() {
      return 'https://storage.example/upload-part';
    },
    async completeMultipartUpload() {},
    async abortMultipartUpload() {},
  };
  const manifestServer = createApp({
    tokenVerifier: verifier,
    users,
    projects,
    scenes,
    assets,
    storage,
  }).listen(0);
  await new Promise<void>((resolve) => manifestServer.once('listening', resolve));
  const address = manifestServer.address();
  if (!address || typeof address === 'string')
    throw new Error('Test server did not expose a TCP address.');
  const manifestOrigin = `http://127.0.0.1:${address.port}`;
  const headers = { authorization: 'Bearer owner-token', 'content-type': 'application/json' };

  try {
    const manifestResponse = await fetch(`${manifestOrigin}/projects/owner-project/manifest`, {
      headers,
    });
    expect(manifestResponse.status).toBe(200);
    await expect(manifestResponse.json()).resolves.toMatchObject({
      id: 'scene-1',
      revision: 3,
      environment: {
        id: 'environment-1',
        state: 'READY',
        filename: 'site.spz',
        url: 'https://storage.example/temporary-download',
      },
      variants: [],
      annotations: [],
    });
    expect(resolvedKey).toBe('projects/owner-project/assets/environment-1/original/site.spz');

    const updateBody = {
      revision: 3,
      environmentAssetId: 'environment-1',
      environmentTransform: scene.environmentTransform,
      variants: [
        {
          id: 'client-provided-id',
          assetId: 'building-1',
          name: 'Main building',
          transform: {
            position: [1, 2, 3],
            quaternion: [0, 0, 0, 1],
            scale: [1, 1, 1],
          },
          visible: true,
          displayOrder: 0,
        },
      ],
      viewerSettings: {
        schemaVersion: 2,
        environmentVisible: false,
        buildingVisible: true,
        sky: { visible: false, rotationYDegrees: 45 },
      },
      defaultCamera: { position: [1, 2, 3], target: [0, 0, 0], fov: 65 },
    };
    const update = await fetch(`${manifestOrigin}/projects/owner-project/scene`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(updateBody),
    });
    expect(update.status).toBe(200);
    await expect(update.json()).resolves.toMatchObject({
      revision: 4,
      viewerSettings: { environmentVisible: false },
      defaultCamera: updateBody.defaultCamera,
      variants: [
        {
          id: 'building-1',
          assetId: 'building-1',
          filename: 'building.glb',
          url: 'https://storage.example/temporary-download',
        },
      ],
    });

    const stale = await fetch(`${manifestOrigin}/projects/owner-project/scene`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(updateBody),
    });
    expect(stale.status).toBe(409);

    const invalid = await fetch(`${manifestOrigin}/projects/owner-project/scene`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ ...updateBody, revision: 4, viewerSettings: { schemaVersion: 3 } }),
    });
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toEqual({
      error: 'Viewer settings use an unsupported schema version.',
    });
  } finally {
    await new Promise<void>((resolve, reject) => {
      manifestServer.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test('anonymous share manifests are token-only, sanitized and immediately respect disablement', async () => {
  const verifier: TokenVerifier = {
    async verifyIdToken(token) {
      if (token !== 'owner-token') throw new Error('invalid token');
      return {
        firebaseUid: 'owner-id',
        email: 'owner@example.com',
        displayName: 'Owner',
        photoUrl: null,
      };
    },
  };
  const users: UserRepository = {
    async upsertFirebaseUser(user) {
      return {
        id: user.firebaseUid,
        ...user,
        createdAt: '2026-07-18T00:00:00.000Z',
        updatedAt: '2026-07-18T00:00:00.000Z',
      };
    },
  };
  const projects: ProjectRepository = {
    async listOwnedProjects() {
      return [];
    },
    async createProject(_ownerFirebaseUid, input) {
      return projectSummary('owner-project', input.name);
    },
    async getProject(projectId) {
      return projectId === 'owner-project'
        ? { ...projectSummary(projectId, 'Presentation project'), ownerFirebaseUid: 'owner-id' }
        : null;
    },
    async updateProject() {
      return null;
    },
    async archiveProject() {
      return null;
    },
    async deleteProject() {
      return true;
    },
  };
  const scene: SceneRecord = {
    id: 'private-scene-id',
    projectId: 'owner-project',
    ownerFirebaseUid: 'owner-id',
    revision: 7,
    environmentAssetId: 'environment-1',
    environmentTransform: {
      position: [0, 0, 0],
      quaternion: [0, 0, 0, 1],
      scale: [1, 1, 1],
    },
    variants: [
      {
        id: 'building-1',
        assetId: 'building-1',
        name: 'Approved design',
        transform: {
          position: [1, 0, 0],
          quaternion: [0, 0, 0, 1],
          scale: [1, 1, 1],
        },
        visible: true,
        displayOrder: 0,
      },
    ],
    viewerSettings: {
      schemaVersion: 2,
      environmentVisible: true,
      buildingVisible: true,
      sky: { visible: true, rotationYDegrees: 0 },
    },
    defaultCamera: { position: [3, 2, 3], target: [0, 0, 0], fov: 55 },
    createdAt: '2026-07-18T00:00:00.000Z',
    updatedAt: '2026-07-18T00:00:00.000Z',
  };
  const scenes: SceneRepository = {
    async getScene(projectId) {
      return projectId === scene.projectId ? scene : null;
    },
    async updateScene() {
      return null;
    },
  };
  const assets: AssetRepository = {
    async createAsset() {
      return null;
    },
    async setAssetOriginalKey() {
      return false;
    },
    async getAsset(assetId) {
      const assetsById: Record<
        string,
        AssetRecord & { ownerFirebaseUid: string; originalKey: string }
      > = {
        'environment-1': {
          id: 'environment-1',
          projectId: 'owner-project',
          kind: 'ENVIRONMENT',
          state: 'READY',
          filename: 'private-site.spz',
          contentType: 'application/octet-stream',
          size: 128,
          checksumSha256: null,
          failureReason: null,
          createdAt: '2026-07-18T00:00:00.000Z',
          updatedAt: '2026-07-18T00:00:00.000Z',
          deletedAt: null,
          ownerFirebaseUid: 'owner-id',
          originalKey: 'projects/owner-project/assets/environment-1/original/private-site.spz',
        },
        'building-1': {
          id: 'building-1',
          projectId: 'owner-project',
          kind: 'BUILDING',
          state: 'READY',
          filename: 'private-building.glb',
          contentType: 'model/gltf-binary',
          size: 128,
          checksumSha256: null,
          failureReason: null,
          createdAt: '2026-07-18T00:00:00.000Z',
          updatedAt: '2026-07-18T00:00:00.000Z',
          deletedAt: null,
          ownerFirebaseUid: 'owner-id',
          originalKey: 'projects/owner-project/assets/building-1/original/private-building.glb',
        },
      };
      return assetsById[assetId] ?? null;
    },
    async updateAssetState() {
      return null;
    },
  };
  let links: Array<ShareLink & { tokenHash: string }> = [];
  const shares: ShareLinkRepository = {
    async createShareLink(input) {
      const link: ShareLink & { tokenHash: string } = {
        id: `share-${links.length + 1}`,
        projectId: input.projectId,
        enabled: true,
        expiresAt: input.expiresAt,
        revokedAt: null,
        permissions: input.permissions,
        createdAt: '2026-07-18T00:00:00.000Z',
        updatedAt: '2026-07-18T00:00:00.000Z',
        tokenHash: input.tokenHash,
      };
      links = [link, ...links];
      return link;
    },
    async listShareLinks(projectId) {
      return links.filter((link) => link.projectId === projectId);
    },
    async getShareLink(shareLinkId) {
      return links.find((link) => link.id === shareLinkId) ?? null;
    },
    async getActiveShareLinkByTokenHash(tokenHash, now) {
      return (
        links.find(
          (link) =>
            link.tokenHash === tokenHash &&
            link.enabled &&
            link.revokedAt === null &&
            (!link.expiresAt || new Date(link.expiresAt) > now),
        ) ?? null
      );
    },
    async updateShareLink(shareLinkId, update) {
      const index = links.findIndex((link) => link.id === shareLinkId && link.revokedAt === null);
      if (index < 0) return null;
      const existing = links[index]!;
      const updated = {
        ...existing,
        ...update,
        permissions: { ...existing.permissions, ...update.permissions },
      };
      links[index] = updated;
      return updated;
    },
    async regenerateShareLink(shareLinkId, tokenHash) {
      const link = links.find(
        (candidate) => candidate.id === shareLinkId && candidate.revokedAt === null,
      );
      if (!link) return null;
      link.tokenHash = tokenHash;
      link.enabled = true;
      return link;
    },
    async revokeShareLink(shareLinkId) {
      const link = links.find(
        (candidate) => candidate.id === shareLinkId && candidate.revokedAt === null,
      );
      if (!link) return null;
      link.enabled = false;
      link.revokedAt = '2026-07-18T01:00:00.000Z';
      return link;
    },
  };
  const storage: AssetStorage = {
    async createUploadUrl() {
      return 'https://storage.example/upload';
    },
    async createDownloadUrl() {
      return 'https://storage.example/temporary-download';
    },
    async getObjectMetadata() {
      return { contentLength: 128, checksumSha256: undefined };
    },
    async getObjectHeader() {
      return new Uint8Array();
    },
    async createMultipartUpload() {
      return 'upload-id';
    },
    async createMultipartPartUrl() {
      return 'https://storage.example/upload-part';
    },
    async completeMultipartUpload() {},
    async abortMultipartUpload() {},
  };
  const shareServer = createApp({
    tokenVerifier: verifier,
    users,
    projects,
    scenes,
    assets,
    shares,
    storage,
  }).listen(0);
  await new Promise<void>((resolve) => shareServer.once('listening', resolve));
  const address = shareServer.address();
  if (!address || typeof address === 'string')
    throw new Error('Test server did not expose a TCP address.');
  const shareOrigin = `http://127.0.0.1:${address.port}`;

  try {
    const unauthenticatedMutation = await fetch(`${shareOrigin}/projects/owner-project/shares`, {
      method: 'POST',
    });
    expect(unauthenticatedMutation.status).toBe(401);

    const created = await fetch(`${shareOrigin}/projects/owner-project/shares`, {
      method: 'POST',
      headers: { authorization: 'Bearer owner-token', 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as { link: ShareLink; token: string };
    expect(createdBody.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(links[0]?.tokenHash).toBe(createHash('sha256').update(createdBody.token).digest('hex'));

    const publicManifest = await fetch(
      `${shareOrigin}/public/shares/${createdBody.token}/manifest`,
    );
    expect(publicManifest.status).toBe(200);
    expect(publicManifest.headers.get('referrer-policy')).toBe('no-referrer');
    const manifest = (await publicManifest.json()) as Record<string, unknown>;
    expect(manifest).toMatchObject({
      project: { name: 'Presentation project' },
      environment: { format: 'SPZ' },
      variants: [{ name: 'Approved design', asset: { format: 'GLB' } }],
    });
    expect(manifest).not.toHaveProperty('projectId');
    expect(JSON.stringify(manifest)).not.toContain('owner-id');
    expect(JSON.stringify(manifest)).not.toContain('private-site.spz');
    expect(JSON.stringify(manifest)).not.toContain('private-building.glb');

    const disabled = await fetch(
      `${shareOrigin}/projects/owner-project/shares/${createdBody.link.id}`,
      {
        method: 'PATCH',
        headers: { authorization: 'Bearer owner-token', 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      },
    );
    expect(disabled.status).toBe(200);
    const afterDisable = await fetch(`${shareOrigin}/public/shares/${createdBody.token}/manifest`);
    expect(afterDisable.status).toBe(404);
  } finally {
    await new Promise<void>((resolve, reject) => {
      shareServer.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

function projectSummary(id: string, name: string) {
  return {
    id,
    name,
    coverUrl: null,
    assetStatus: 'NO_ASSETS' as const,
    shareStatus: 'NOT_SHARED' as const,
    createdAt: '2026-07-18T00:00:00.000Z',
    updatedAt: '2026-07-18T01:00:00.000Z',
    archivedAt: null,
    assets: [],
  };
}
