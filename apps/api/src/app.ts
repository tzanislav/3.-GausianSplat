import type { TokenVerifier } from '@gaussian-viewer/auth';
import {
  CreateAssetUploadInputSchema,
  CreateMultipartUploadInputSchema,
  MultipartPartUrlInputSchema,
  SceneUpdateInputSchema,
  CreateProjectInputSchema,
  ProjectSettingsInputSchema,
  RecordMultipartPartInputSchema,
  type AssetKind,
  type AssetRecord,
  type FirebaseUser,
  type UploadSession,
} from '@gaussian-viewer/contracts';
import type {
  AssetRepository,
  ProjectRepository,
  SceneRepository,
  SceneRecord,
  UploadSessionRepository,
  UserRepository,
} from '@gaussian-viewer/database';
import express, { type Express, type RequestHandler, type Response } from 'express';
import { assetStorageTimings, type AssetStorage } from './storage.js';

const MAX_DIRECT_UPLOAD_BYTES = 100 * 1024 * 1024;
const MULTIPART_PART_SIZE = 16 * 1024 * 1024;
const MAX_MULTIPART_PARTS = 10_000;

export interface AppDependencies {
  tokenVerifier?: TokenVerifier;
  users?: UserRepository;
  projects?: ProjectRepository;
  scenes?: SceneRepository;
  assets?: AssetRepository;
  uploadSessions?: UploadSessionRepository;
  storage?: AssetStorage;
}

export function createApp(dependencies: AppDependencies = {}): Express {
  const app = express();
  app.use(express.json());

  app.get('/health', (_request, response) => {
    response.status(200).json({ status: 'ok' });
  });

  const requireAuthentication: RequestHandler = async (request, response, next) => {
    if (!dependencies.tokenVerifier || !dependencies.users) {
      response.status(503).json({ error: 'Authentication is not configured.' });
      return;
    }

    const authorization = request.header('authorization');
    if (!authorization?.startsWith('Bearer ')) {
      response.status(401).json({ error: 'A Firebase ID token is required.' });
      return;
    }

    try {
      response.locals.firebaseUser = await dependencies.tokenVerifier.verifyIdToken(
        authorization.slice('Bearer '.length),
      );
      next();
    } catch {
      response.status(401).json({ error: 'The Firebase ID token is invalid or expired.' });
    }
  };

  app.get('/auth/me', requireAuthentication, async (_request, response, next) => {
    try {
      const firebaseUser = response.locals.firebaseUser as FirebaseUser;
      const user = await dependencies.users?.upsertFirebaseUser(firebaseUser);
      response.status(200).json(user);
    } catch (error) {
      next(error);
    }
  });

  app.get('/projects', requireAuthentication, async (_request, response, next) => {
    try {
      const projects = requireProjects(dependencies, response);
      if (!projects) {
        return;
      }
      const firebaseUser = response.locals.firebaseUser as FirebaseUser;
      response.status(200).json(await projects.listOwnedProjects(firebaseUser.firebaseUid));
    } catch (error) {
      next(error);
    }
  });

  app.post('/projects', requireAuthentication, async (request, response, next) => {
    try {
      const input = CreateProjectInputSchema.safeParse(request.body);
      if (!input.success) {
        response.status(400).json({ error: 'Project name must be between 1 and 120 characters.' });
        return;
      }
      const projects = requireProjects(dependencies, response);
      if (!projects) {
        return;
      }
      const firebaseUser = response.locals.firebaseUser as FirebaseUser;
      response.status(201).json(await projects.createProject(firebaseUser.firebaseUid, input.data));
    } catch (error) {
      next(error);
    }
  });

  app.get('/projects/:projectId', requireAuthentication, async (request, response, next) => {
    try {
      const project = await getOwnedProject(
        dependencies,
        response,
        projectIdFrom(request.params.projectId),
      );
      if (project) {
        response.status(200).json(project);
      }
    } catch (error) {
      next(error);
    }
  });

  app.patch('/projects/:projectId', requireAuthentication, async (request, response, next) => {
    try {
      const input = ProjectSettingsInputSchema.safeParse(request.body);
      if (!input.success) {
        response.status(400).json({ error: 'Project name must be between 1 and 120 characters.' });
        return;
      }
      const owned = await getOwnedProject(
        dependencies,
        response,
        projectIdFrom(request.params.projectId),
      );
      if (!owned) {
        return;
      }
      const projects = requireProjects(dependencies, response);
      if (!projects) {
        return;
      }
      const updated = await projects.updateProject(owned.id, input.data);
      response.status(200).json(updated);
    } catch (error) {
      next(error);
    }
  });

  app.post(
    '/projects/:projectId/archive',
    requireAuthentication,
    async (request, response, next) => {
      try {
        const owned = await getOwnedProject(
          dependencies,
          response,
          projectIdFrom(request.params.projectId),
        );
        if (!owned) {
          return;
        }
        const projects = requireProjects(dependencies, response);
        if (!projects) {
          return;
        }
        const archived = await projects.archiveProject(owned.id);
        response.status(200).json(archived);
      } catch (error) {
        next(error);
      }
    },
  );

  app.delete('/projects/:projectId', requireAuthentication, async (request, response, next) => {
    try {
      const owned = await getOwnedProject(
        dependencies,
        response,
        projectIdFrom(request.params.projectId),
      );
      if (!owned) {
        return;
      }
      const projects = requireProjects(dependencies, response);
      if (!projects) {
        return;
      }
      await projects.deleteProject(owned.id);
      response.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  app.get(
    '/projects/:projectId/manifest',
    requireAuthentication,
    async (request, response, next) => {
      try {
        const project = await getOwnedProject(
          dependencies,
          response,
          projectIdFrom(request.params.projectId),
        );
        const scenes = requireScenes(dependencies, response);
        const assets = requireAssets(dependencies, response);
        const storage = requireStorage(dependencies, response);
        if (!project || !scenes || !assets || !storage) return;
        const scene = await scenes.getScene(project.id);
        if (!scene) {
          response.status(404).json({ error: 'Scene not found.' });
          return;
        }
        response.status(200).json(await toOwnerManifest(scene, assets, storage));
      } catch (error) {
        next(error);
      }
    },
  );

  app.put('/projects/:projectId/scene', requireAuthentication, async (request, response, next) => {
    try {
      const project = await getOwnedProject(
        dependencies,
        response,
        projectIdFrom(request.params.projectId),
      );
      const input = SceneUpdateInputSchema.safeParse(request.body);
      const scenes = requireScenes(dependencies, response);
      const assets = requireAssets(dependencies, response);
      const storage = requireStorage(dependencies, response);
      if (!project || !input.success || !scenes || !assets || !storage) {
        if (project && !input.success) {
          const schemaVersion = request.body?.viewerSettings?.schemaVersion;
          response.status(400).json({
            error:
              typeof schemaVersion === 'number' && schemaVersion !== 1
                ? 'Viewer settings use an unsupported schema version.'
                : 'Scene settings are invalid.',
          });
        }
        return;
      }
      if (input.data.environmentAssetId) {
        const asset = await assets.getAsset(input.data.environmentAssetId);
        if (
          !asset ||
          asset.projectId !== project.id ||
          asset.state !== 'READY' ||
          asset.kind !== 'ENVIRONMENT'
        ) {
          response
            .status(400)
            .json({ error: 'Environment asset must be a ready project environment.' });
          return;
        }
      }
      for (const variant of input.data.variants) {
        const asset = await assets.getAsset(variant.assetId);
        if (
          !asset ||
          asset.projectId !== project.id ||
          asset.state !== 'READY' ||
          asset.kind !== 'BUILDING'
        ) {
          response.status(400).json({ error: 'Building asset must be a ready project building.' });
          return;
        }
      }
      const updated = await scenes.updateScene(project.id, {
        ...input.data,
        variants: input.data.variants.map((variant) => ({ ...variant, id: variant.assetId })),
      });
      if (updated === 'STALE') {
        response.status(409).json({ error: 'Scene has changed. Reload before saving again.' });
        return;
      }
      if (!updated) {
        response.status(404).json({ error: 'Scene not found.' });
        return;
      }
      response.status(200).json(await toOwnerManifest(updated, assets, storage));
    } catch (error) {
      next(error);
    }
  });

  app.post(
    '/projects/:projectId/assets/uploads',
    requireAuthentication,
    async (request, response, next) => {
      try {
        const project = await getOwnedProject(
          dependencies,
          response,
          projectIdFrom(request.params.projectId),
        );
        if (!project) {
          return;
        }
        const input = CreateAssetUploadInputSchema.safeParse(request.body);
        if (!input.success) {
          response.status(400).json({ error: 'The asset upload request is invalid.' });
          return;
        }
        const descriptor = describeAssetUpload(
          input.data.kind,
          input.data.filename,
          input.data.size,
        );
        if (!descriptor) {
          response.status(400).json({ error: assetUploadValidationMessage(input.data.kind) });
          return;
        }
        const assets = requireAssets(dependencies, response);
        const storage = requireStorage(dependencies, response);
        if (!assets || !storage) {
          return;
        }
        const firebaseUser = response.locals.firebaseUser as FirebaseUser;
        const asset = await assets.createAsset(
          firebaseUser.firebaseUid,
          project.id,
          { ...input.data, contentType: descriptor.contentType },
          '',
        );
        if (!asset) {
          response.status(409).json({ error: 'The project could not accept this asset.' });
          return;
        }
        const key = `projects/${project.id}/assets/${asset.id}/original/${storageFilename(input.data.filename)}`;
        if (!(await assets.setAssetOriginalKey(asset.id, key))) {
          response.status(500).json({ error: 'The asset storage key could not be reserved.' });
          return;
        }

        try {
          const uploadUrl = await storage.createUploadUrl({
            key,
            contentType: descriptor.contentType,
            checksumSha256: input.data.checksumSha256,
          });
          const uploading = await assets.updateAssetState(asset.id, ['CREATED'], 'UPLOADING');
          if (!uploading) {
            response.status(409).json({ error: 'The asset upload is no longer available.' });
            return;
          }
          response.status(201).json({
            assetId: asset.id,
            state: uploading.state,
            uploadUrl,
            headers: {
              'content-type': descriptor.contentType,
              'x-amz-checksum-sha256': input.data.checksumSha256,
            },
            expiresAt: new Date(
              Date.now() + assetStorageTimings.uploadUrlTtlSeconds * 1000,
            ).toISOString(),
          });
        } catch (error) {
          await assets.updateAssetState(
            asset.id,
            ['CREATED'],
            'FAILED',
            'Upload URL generation failed.',
          );
          throw error;
        }
      } catch (error) {
        next(error);
      }
    },
  );

  app.post(
    '/projects/:projectId/assets/:assetId/complete',
    requireAuthentication,
    async (request, response, next) => {
      try {
        const asset = await getOwnedAsset(
          dependencies,
          response,
          projectIdFrom(request.params.projectId),
          projectIdFrom(request.params.assetId),
        );
        if (!asset) {
          return;
        }
        const storage = requireStorage(dependencies, response);
        if (!storage) {
          return;
        }
        if (asset.state !== 'UPLOADING') {
          response.status(409).json({ error: 'This asset is not awaiting upload completion.' });
          return;
        }
        const assets = requireAssets(dependencies, response);
        if (!assets) {
          return;
        }
        if (!(await assets.updateAssetState(asset.id, ['UPLOADING'], 'UPLOADED'))) {
          response
            .status(409)
            .json({ error: 'This asset upload changed state before validation.' });
          return;
        }
        if (!(await assets.updateAssetState(asset.id, ['UPLOADED'], 'VALIDATING'))) {
          response.status(409).json({ error: 'This asset could not be validated.' });
          return;
        }

        let metadata: Awaited<ReturnType<AssetStorage['getObjectMetadata']>>;
        let header: Uint8Array;
        try {
          metadata = await storage.getObjectMetadata(asset.originalKey);
          header = await storage.getObjectHeader(asset.originalKey);
        } catch {
          await assets.updateAssetState(
            asset.id,
            ['VALIDATING'],
            'FAILED',
            'Uploaded object could not be verified.',
          );
          response.status(422).json({ error: 'Uploaded object could not be verified.' });
          return;
        }
        if (
          metadata.contentLength !== asset.size ||
          metadata.checksumSha256 !== asset.checksumSha256
        ) {
          await assets.updateAssetState(
            asset.id,
            ['VALIDATING'],
            'FAILED',
            'Uploaded object metadata did not match the upload request.',
          );
          response
            .status(422)
            .json({ error: 'Uploaded object metadata did not match the upload request.' });
          return;
        }
        if (!hasExpectedMagicBytes(asset.kind, asset.filename, header)) {
          await assets.updateAssetState(
            asset.id,
            ['VALIDATING'],
            'FAILED',
            'Uploaded object did not contain the expected file signature.',
          );
          response
            .status(422)
            .json({ error: 'Uploaded object did not contain the expected file signature.' });
          return;
        }
        const ready = await assets.updateAssetState(asset.id, ['VALIDATING'], 'READY');
        if (!ready) {
          response
            .status(409)
            .json({ error: 'This asset changed state before validation completed.' });
          return;
        }
        response.status(200).json(ready);
      } catch (error) {
        next(error);
      }
    },
  );

  app.get(
    '/projects/:projectId/assets/:assetId/download',
    requireAuthentication,
    async (request, response, next) => {
      try {
        const asset = await getOwnedAsset(
          dependencies,
          response,
          projectIdFrom(request.params.projectId),
          projectIdFrom(request.params.assetId),
        );
        if (!asset) {
          return;
        }
        if (asset.state !== 'READY') {
          response.status(409).json({ error: 'Only ready assets can be downloaded.' });
          return;
        }
        const storage = requireStorage(dependencies, response);
        if (!storage) {
          return;
        }
        response.status(200).json({
          url: await storage.createDownloadUrl(asset.originalKey),
          expiresAt: new Date(
            Date.now() + assetStorageTimings.downloadUrlTtlSeconds * 1000,
          ).toISOString(),
        });
      } catch (error) {
        next(error);
      }
    },
  );

  app.delete(
    '/projects/:projectId/assets/:assetId',
    requireAuthentication,
    async (request, response, next) => {
      try {
        const asset = await getOwnedAsset(
          dependencies,
          response,
          projectIdFrom(request.params.projectId),
          projectIdFrom(request.params.assetId),
        );
        if (!asset) {
          return;
        }
        const assets = requireAssets(dependencies, response);
        if (!assets) {
          return;
        }
        const deleted = await assets.updateAssetState(
          asset.id,
          ['CREATED', 'UPLOADING', 'UPLOADED', 'VALIDATING', 'READY', 'FAILED'],
          'DELETED',
        );
        if (!deleted) {
          response.status(409).json({ error: 'This asset has already been deleted.' });
          return;
        }
        response.status(204).end();
      } catch (error) {
        next(error);
      }
    },
  );

  app.post(
    '/projects/:projectId/uploads/multipart',
    requireAuthentication,
    async (request, response, next) => {
      try {
        const project = await getOwnedProject(
          dependencies,
          response,
          projectIdFrom(request.params.projectId),
        );
        if (!project) {
          return;
        }
        const input = CreateMultipartUploadInputSchema.safeParse(request.body);
        if (!input.success || !isValidMultipartUpload(input.success ? input.data : undefined)) {
          response.status(400).json({ error: multipartUploadValidationMessage() });
          return;
        }
        const descriptor = describeMultipartAsset(input.data.filename);
        if (!descriptor) {
          response.status(400).json({ error: multipartUploadValidationMessage() });
          return;
        }
        const assets = requireAssets(dependencies, response);
        const uploadSessions = requireUploadSessions(dependencies, response);
        const storage = requireStorage(dependencies, response);
        if (!assets || !uploadSessions || !storage) {
          return;
        }
        const firebaseUser = response.locals.firebaseUser as FirebaseUser;
        const asset = await assets.createAsset(
          firebaseUser.firebaseUid,
          project.id,
          { ...input.data, contentType: descriptor.contentType, checksumSha256: null },
          '',
        );
        if (!asset) {
          response.status(409).json({ error: 'The project could not accept this asset.' });
          return;
        }
        const key = `projects/${project.id}/assets/${asset.id}/original/${storageFilename(input.data.filename)}`;
        if (!(await assets.setAssetOriginalKey(asset.id, key))) {
          response.status(500).json({ error: 'The asset storage key could not be reserved.' });
          return;
        }
        try {
          const s3UploadId = await storage.createMultipartUpload({
            key,
            contentType: descriptor.contentType,
          });
          const session = await uploadSessions.createUploadSession({
            assetId: asset.id,
            projectId: project.id,
            ownerFirebaseUid: firebaseUser.firebaseUid,
            storageKey: key,
            s3UploadId,
            partSize: MULTIPART_PART_SIZE,
            totalParts: Math.ceil(input.data.size / MULTIPART_PART_SIZE),
          });
          if (!session) {
            await storage.abortMultipartUpload({ key, uploadId: s3UploadId });
            throw new Error('The multipart upload session could not be created.');
          }
          const uploading = await assets.updateAssetState(asset.id, ['CREATED'], 'UPLOADING');
          if (!uploading) {
            await storage.abortMultipartUpload({ key, uploadId: s3UploadId });
            response.status(409).json({ error: 'The asset upload is no longer available.' });
            return;
          }
          response.status(201).json(session);
        } catch (error) {
          await assets.updateAssetState(
            asset.id,
            ['CREATED'],
            'FAILED',
            'Multipart upload initiation failed.',
          );
          throw error;
        }
      } catch (error) {
        next(error);
      }
    },
  );

  app.get(
    '/projects/:projectId/uploads/:sessionId',
    requireAuthentication,
    async (request, response, next) => {
      try {
        const session = await getOwnedUploadSession(
          dependencies,
          response,
          projectIdFrom(request.params.projectId),
          projectIdFrom(request.params.sessionId),
        );
        if (session) {
          response.status(200).json(session);
        }
      } catch (error) {
        next(error);
      }
    },
  );

  app.post(
    '/projects/:projectId/uploads/:sessionId/parts/:partNumber/url',
    requireAuthentication,
    async (request, response, next) => {
      try {
        const session = await getOwnedUploadSession(
          dependencies,
          response,
          projectIdFrom(request.params.projectId),
          projectIdFrom(request.params.sessionId),
        );
        if (!session) {
          return;
        }
        const partNumber = partNumberFrom(request.params.partNumber);
        const input = MultipartPartUrlInputSchema.safeParse(request.body);
        if (!input.success || !isValidSessionPart(session, partNumber)) {
          response.status(400).json({ error: 'The multipart part request is invalid.' });
          return;
        }
        if (session.parts.some((part) => part.partNumber === partNumber)) {
          response.status(409).json({ error: 'This multipart part has already been recorded.' });
          return;
        }
        const storage = requireStorage(dependencies, response);
        if (!storage) {
          return;
        }
        response.status(200).json({
          url: await storage.createMultipartPartUrl({
            key: session.storageKey,
            uploadId: session.s3UploadId,
            partNumber,
            checksumSha256: input.data.checksumSha256,
          }),
          headers: { 'x-amz-checksum-sha256': input.data.checksumSha256 },
          expiresAt: new Date(
            Date.now() + assetStorageTimings.uploadUrlTtlSeconds * 1000,
          ).toISOString(),
        });
      } catch (error) {
        next(error);
      }
    },
  );

  app.post(
    '/projects/:projectId/uploads/:sessionId/parts/:partNumber',
    requireAuthentication,
    async (request, response, next) => {
      try {
        const session = await getOwnedUploadSession(
          dependencies,
          response,
          projectIdFrom(request.params.projectId),
          projectIdFrom(request.params.sessionId),
        );
        if (!session) {
          return;
        }
        const partNumber = partNumberFrom(request.params.partNumber);
        const input = RecordMultipartPartInputSchema.safeParse(request.body);
        const asset = await requireSessionAsset(dependencies, response, session.assetId);
        if (
          !input.success ||
          !asset ||
          !isValidSessionPart(session, partNumber) ||
          input.data.size !== multipartPartSize(asset.size, session.partSize, partNumber)
        ) {
          response.status(400).json({ error: 'The multipart part completion is invalid.' });
          return;
        }
        const uploadSessions = requireUploadSessions(dependencies, response);
        if (!uploadSessions) {
          return;
        }
        const updated = await uploadSessions.recordPart(session.id, {
          partNumber,
          ...input.data,
        });
        if (!updated) {
          response.status(409).json({ error: 'This multipart part has already been recorded.' });
          return;
        }
        response.status(200).json(updated);
      } catch (error) {
        next(error);
      }
    },
  );

  app.post(
    '/projects/:projectId/uploads/:sessionId/complete',
    requireAuthentication,
    async (request, response, next) => {
      try {
        const session = await getOwnedUploadSession(
          dependencies,
          response,
          projectIdFrom(request.params.projectId),
          projectIdFrom(request.params.sessionId),
        );
        if (!session) {
          return;
        }
        if (session.state !== 'UPLOADING' || session.parts.length !== session.totalParts) {
          response
            .status(409)
            .json({ error: 'All multipart parts must be recorded before completion.' });
          return;
        }
        const asset = await requireSessionAsset(dependencies, response, session.assetId);
        const assets = requireAssets(dependencies, response);
        const uploadSessions = requireUploadSessions(dependencies, response);
        const storage = requireStorage(dependencies, response);
        if (!asset || !assets || !uploadSessions || !storage) {
          return;
        }
        await storage.completeMultipartUpload({
          key: session.storageKey,
          uploadId: session.s3UploadId,
          parts: session.parts,
        });
        if (!(await assets.updateAssetState(asset.id, ['UPLOADING'], 'UPLOADED'))) {
          response
            .status(409)
            .json({ error: 'This asset upload changed state before validation.' });
          return;
        }
        if (!(await assets.updateAssetState(asset.id, ['UPLOADED'], 'VALIDATING'))) {
          response.status(409).json({ error: 'This asset could not be validated.' });
          return;
        }
        const validated = await validateUploadedAsset(assets, storage, asset, true);
        if (!validated) {
          response
            .status(422)
            .json({ error: 'The completed multipart object could not be validated.' });
          return;
        }
        await uploadSessions.updateUploadSessionState(session.id, 'UPLOADING', 'COMPLETED');
        response.status(200).json(validated);
      } catch (error) {
        next(error);
      }
    },
  );

  app.delete(
    '/projects/:projectId/uploads/:sessionId',
    requireAuthentication,
    async (request, response, next) => {
      try {
        const session = await getOwnedUploadSession(
          dependencies,
          response,
          projectIdFrom(request.params.projectId),
          projectIdFrom(request.params.sessionId),
        );
        if (!session) {
          return;
        }
        if (session.state !== 'UPLOADING') {
          response.status(409).json({ error: 'This multipart upload is no longer active.' });
          return;
        }
        const storage = requireStorage(dependencies, response);
        const uploadSessions = requireUploadSessions(dependencies, response);
        const assets = requireAssets(dependencies, response);
        if (!storage || !uploadSessions || !assets) {
          return;
        }
        await storage.abortMultipartUpload({
          key: session.storageKey,
          uploadId: session.s3UploadId,
        });
        await uploadSessions.updateUploadSessionState(session.id, 'UPLOADING', 'ABORTED');
        await assets.updateAssetState(session.assetId, ['UPLOADING'], 'DELETED');
        response.status(204).end();
      } catch (error) {
        next(error);
      }
    },
  );

  return app;
}

function requireProjects(
  dependencies: AppDependencies,
  response: Response,
): ProjectRepository | undefined {
  if (dependencies.projects) {
    return dependencies.projects;
  }
  response.status(503).json({ error: 'Projects are not configured.' });
  return undefined;
}

function requireScenes(
  dependencies: AppDependencies,
  response: Response,
): SceneRepository | undefined {
  if (dependencies.scenes) return dependencies.scenes;
  response.status(503).json({ error: 'Scenes are not configured.' });
  return undefined;
}

function requireAssets(
  dependencies: AppDependencies,
  response: Response,
): AssetRepository | undefined {
  if (dependencies.assets) {
    return dependencies.assets;
  }
  response.status(503).json({ error: 'Asset storage is not configured.' });
  return undefined;
}

function requireStorage(
  dependencies: AppDependencies,
  response: Response,
): AssetStorage | undefined {
  if (dependencies.storage) {
    return dependencies.storage;
  }
  response.status(503).json({ error: 'Asset storage is not configured.' });
  return undefined;
}

function requireUploadSessions(
  dependencies: AppDependencies,
  response: Response,
): UploadSessionRepository | undefined {
  if (dependencies.uploadSessions) {
    return dependencies.uploadSessions;
  }
  response.status(503).json({ error: 'Multipart uploads are not configured.' });
  return undefined;
}

async function getOwnedProject(
  dependencies: AppDependencies,
  response: Response,
  projectId: string,
) {
  const projects = requireProjects(dependencies, response);
  if (!projects) {
    return undefined;
  }
  const project = await projects.getProject(projectId);
  if (!project) {
    response.status(404).json({ error: 'Project not found.' });
    return undefined;
  }
  const firebaseUser = response.locals.firebaseUser as FirebaseUser;
  if (project.ownerFirebaseUid !== firebaseUser.firebaseUid) {
    response.status(403).json({ error: 'You do not own this project.' });
    return undefined;
  }
  return project;
}

async function getOwnedAsset(
  dependencies: AppDependencies,
  response: Response,
  projectId: string,
  assetId: string,
): Promise<(AssetRecord & { ownerFirebaseUid: string; originalKey: string }) | undefined> {
  const project = await getOwnedProject(dependencies, response, projectId);
  if (!project) {
    return undefined;
  }
  const assets = requireAssets(dependencies, response);
  if (!assets) {
    return undefined;
  }
  const asset = await assets.getAsset(assetId);
  const firebaseUser = response.locals.firebaseUser as FirebaseUser;
  if (
    !asset ||
    asset.projectId !== project.id ||
    asset.ownerFirebaseUid !== firebaseUser.firebaseUid
  ) {
    response.status(404).json({ error: 'Asset not found.' });
    return undefined;
  }
  return asset;
}

async function getOwnedUploadSession(
  dependencies: AppDependencies,
  response: Response,
  projectId: string,
  sessionId: string,
): Promise<
  (UploadSession & { ownerFirebaseUid: string; storageKey: string; s3UploadId: string }) | undefined
> {
  const project = await getOwnedProject(dependencies, response, projectId);
  if (!project) {
    return undefined;
  }
  const uploadSessions = requireUploadSessions(dependencies, response);
  if (!uploadSessions) {
    return undefined;
  }
  const session = await uploadSessions.getUploadSession(sessionId);
  const firebaseUser = response.locals.firebaseUser as FirebaseUser;
  if (
    !session ||
    session.projectId !== project.id ||
    session.ownerFirebaseUid !== firebaseUser.firebaseUid
  ) {
    response.status(404).json({ error: 'Multipart upload session not found.' });
    return undefined;
  }
  return session;
}

async function requireSessionAsset(
  dependencies: AppDependencies,
  response: Response,
  assetId: string,
): Promise<(AssetRecord & { ownerFirebaseUid: string; originalKey: string }) | undefined> {
  const assets = requireAssets(dependencies, response);
  if (!assets) {
    return undefined;
  }
  const asset = await assets.getAsset(assetId);
  if (!asset) {
    response.status(404).json({ error: 'Asset not found.' });
    return undefined;
  }
  return asset;
}

async function toOwnerManifest(scene: SceneRecord, assets: AssetRepository, storage: AssetStorage) {
  let environment;
  if (scene.environmentAssetId) {
    const asset = await assets.getAsset(scene.environmentAssetId);
    if (asset?.state === 'READY' && asset.kind === 'ENVIRONMENT') {
      environment = {
        id: asset.id,
        kind: asset.kind,
        state: asset.state,
        url: await storage.createDownloadUrl(asset.originalKey),
        filename: asset.filename,
      };
    }
  }
  const variants = await Promise.all(
    scene.variants.map(async (variant) => {
      const asset = await assets.getAsset(variant.assetId);
      if (asset?.state !== 'READY' || asset.kind !== 'BUILDING') {
        return undefined;
      }
      return {
        ...variant,
        url: await storage.createDownloadUrl(asset.originalKey),
        filename: asset.filename,
      };
    }),
  );
  return {
    id: scene.id,
    projectId: scene.projectId,
    revision: scene.revision,
    environment,
    environmentTransform: scene.environmentTransform,
    variants: variants.filter((variant) => variant !== undefined),
    viewerSettings: scene.viewerSettings,
    defaultCamera: scene.defaultCamera,
    annotations: [],
  };
}

function describeMultipartAsset(filename: string) {
  const extension = extensionOf(filename);
  return extension === '.ply' || extension === '.spz'
    ? { contentType: 'application/octet-stream' }
    : undefined;
}

function isValidMultipartUpload(input: { size: number } | undefined): boolean {
  return (
    input !== undefined &&
    input.size > MAX_DIRECT_UPLOAD_BYTES &&
    Math.ceil(input.size / MULTIPART_PART_SIZE) <= MAX_MULTIPART_PARTS
  );
}

function multipartUploadValidationMessage(): string {
  return 'Only .ply or .spz environments above 100 MB and within the multipart part limit can use this route.';
}

function partNumberFrom(value: string | string[] | undefined): number {
  const partNumber = Number(typeof value === 'string' ? value : '');
  return Number.isSafeInteger(partNumber) && partNumber > 0 ? partNumber : 0;
}

function isValidSessionPart(session: UploadSession, partNumber: number): boolean {
  return session.state === 'UPLOADING' && partNumber >= 1 && partNumber <= session.totalParts;
}

function multipartPartSize(totalSize: number, partSize: number, partNumber: number): number {
  return Math.min(partSize, totalSize - (partNumber - 1) * partSize);
}

async function validateUploadedAsset(
  assets: AssetRepository,
  storage: AssetStorage,
  asset: AssetRecord & { originalKey: string },
  allowMultipartChecksum: boolean,
): Promise<AssetRecord | null> {
  let metadata: Awaited<ReturnType<AssetStorage['getObjectMetadata']>>;
  let header: Uint8Array;
  try {
    metadata = await storage.getObjectMetadata(asset.originalKey);
    header = await storage.getObjectHeader(asset.originalKey);
  } catch {
    await assets.updateAssetState(
      asset.id,
      ['VALIDATING'],
      'FAILED',
      'Uploaded object could not be verified.',
    );
    return null;
  }
  const checksumMatches = asset.checksumSha256
    ? metadata.checksumSha256 === asset.checksumSha256
    : allowMultipartChecksum && Boolean(metadata.checksumSha256);
  if (metadata.contentLength !== asset.size || !checksumMatches) {
    await assets.updateAssetState(
      asset.id,
      ['VALIDATING'],
      'FAILED',
      'Uploaded object metadata did not match the upload request.',
    );
    return null;
  }
  if (!hasExpectedMagicBytes(asset.kind, asset.filename, header)) {
    await assets.updateAssetState(
      asset.id,
      ['VALIDATING'],
      'FAILED',
      'Uploaded object did not contain the expected file signature.',
    );
    return null;
  }
  return assets.updateAssetState(asset.id, ['VALIDATING'], 'READY');
}

function describeAssetUpload(kind: AssetKind, filename: string, size: number) {
  if (size > MAX_DIRECT_UPLOAD_BYTES) {
    return undefined;
  }
  const extension = extensionOf(filename);
  if (kind === 'BUILDING' && extension === '.glb') {
    return { contentType: 'model/gltf-binary' };
  }
  if (kind === 'ENVIRONMENT' && (extension === '.ply' || extension === '.spz')) {
    return { contentType: 'application/octet-stream' };
  }
  return undefined;
}

function assetUploadValidationMessage(kind: AssetKind): string {
  const accepted = kind === 'BUILDING' ? '.glb' : '.ply or .spz';
  return `Only ${accepted} files up to 100 MB can use the direct upload route.`;
}

function extensionOf(filename: string): string {
  return (
    filename
      .trim()
      .toLowerCase()
      .match(/\.[a-z0-9]+$/)?.[0] ?? ''
  );
}

function storageFilename(filename: string): string {
  const safe = filename
    .normalize('NFKC')
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .replace(/^[_.]+|[_.]+$/g, '');
  return safe || 'asset';
}

function hasExpectedMagicBytes(kind: AssetKind, filename: string, header: Uint8Array): boolean {
  if (kind === 'BUILDING') {
    return (
      header.length >= 12 &&
      header[0] === 0x67 &&
      header[1] === 0x6c &&
      header[2] === 0x54 &&
      header[3] === 0x46
    );
  }
  if (extensionOf(filename) === '.ply') {
    return (
      header.length >= 4 &&
      header[0] === 0x70 &&
      header[1] === 0x6c &&
      header[2] === 0x79 &&
      (header[3] === 0x0a || header[3] === 0x0d || header[3] === 0x20)
    );
  }
  return (
    header.length >= 4 &&
    header[0] === 0x4e &&
    header[1] === 0x47 &&
    header[2] === 0x53 &&
    header[3] === 0x50
  );
}

function projectIdFrom(value: string | string[] | undefined): string {
  return typeof value === 'string' ? value : '';
}
