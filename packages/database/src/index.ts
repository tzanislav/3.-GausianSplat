import { migrateViewerSettings } from '@gaussian-viewer/contracts';
import type {
  AssetKind,
  AssetRecord,
  AssetState,
  CreateProjectInput,
  DefaultCamera,
  FirebaseUser,
  LocalUser,
  ProjectSettingsInput,
  ProjectSummary,
  SceneVariant,
  SceneUpdateInput,
  ShareLink,
  SharePermissions,
  Transform,
  UpdateShareLinkInput,
  UploadPart,
  UploadSession,
  UploadSessionState,
  ViewerSettings,
} from '@gaussian-viewer/contracts';
import { MongoClient, ObjectId, type Collection } from 'mongodb';

interface MongoUserDocument extends FirebaseUser {
  _id: ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

interface MongoProjectDocument {
  _id: ObjectId;
  ownerFirebaseUid: string;
  name: string;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface MongoSceneDocument {
  _id: ObjectId;
  projectId: ObjectId;
  ownerFirebaseUid: string;
  revision: number;
  environmentAssetId: ObjectId | null;
  environmentTransform: Transform;
  variants: SceneVariant[];
  viewerSettings?: unknown;
  defaultCamera: DefaultCamera | null;
  createdAt: Date;
  updatedAt: Date;
}

interface MongoAssetDocument {
  _id: ObjectId;
  projectId: ObjectId;
  ownerFirebaseUid: string;
  kind: AssetKind;
  state: AssetState;
  filename: string;
  contentType: string;
  size: number;
  checksumSha256: string | null;
  originalKey: string;
  failureReason: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

interface MongoUploadSessionDocument {
  _id: ObjectId;
  assetId: ObjectId;
  projectId: ObjectId;
  ownerFirebaseUid: string;
  storageKey: string;
  s3UploadId: string;
  state: UploadSessionState;
  partSize: number;
  totalParts: number;
  parts: UploadPart[];
  createdAt: Date;
  updatedAt: Date;
}

interface MongoShareLinkDocument {
  _id: ObjectId;
  projectId: ObjectId;
  ownerFirebaseUid: string;
  tokenHash: string;
  enabled: boolean;
  expiresAt: Date | null;
  revokedAt: Date | null;
  permissions: SharePermissions;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserRepository {
  upsertFirebaseUser(user: FirebaseUser): Promise<LocalUser>;
}

export interface ProjectRepository {
  listOwnedProjects(ownerFirebaseUid: string): Promise<ProjectSummary[]>;
  createProject(ownerFirebaseUid: string, input: CreateProjectInput): Promise<ProjectSummary>;
  getProject(projectId: string): Promise<(ProjectSummary & { ownerFirebaseUid: string }) | null>;
  updateProject(projectId: string, input: ProjectSettingsInput): Promise<ProjectSummary | null>;
  archiveProject(projectId: string): Promise<ProjectSummary | null>;
  deleteProject(projectId: string): Promise<boolean>;
}

export interface SceneRecord {
  id: string;
  projectId: string;
  ownerFirebaseUid: string;
  revision: number;
  environmentAssetId: string | null;
  environmentTransform: Transform;
  variants: SceneVariant[];
  viewerSettings: ViewerSettings;
  defaultCamera: DefaultCamera | null;
  createdAt: string;
  updatedAt: string;
}

export interface SceneRepository {
  getScene(projectId: string): Promise<SceneRecord | null>;
  updateScene(projectId: string, input: SceneUpdateInput): Promise<SceneRecord | 'STALE' | null>;
}

export interface NewAsset {
  kind: AssetKind;
  filename: string;
  contentType: string;
  size: number;
  checksumSha256: string | null;
}

export interface NewUploadSession {
  assetId: string;
  projectId: string;
  ownerFirebaseUid: string;
  storageKey: string;
  s3UploadId: string;
  partSize: number;
  totalParts: number;
}

export interface UploadSessionRepository {
  createUploadSession(input: NewUploadSession): Promise<UploadSession | null>;
  getUploadSession(
    sessionId: string,
  ): Promise<
    (UploadSession & { ownerFirebaseUid: string; storageKey: string; s3UploadId: string }) | null
  >;
  recordPart(sessionId: string, part: UploadPart): Promise<UploadSession | null>;
  updateUploadSessionState(
    sessionId: string,
    expectedState: UploadSessionState,
    state: UploadSessionState,
  ): Promise<UploadSession | null>;
}

export interface AssetRepository {
  createAsset(
    ownerFirebaseUid: string,
    projectId: string,
    asset: NewAsset,
    originalKey: string,
  ): Promise<AssetRecord | null>;
  setAssetOriginalKey(assetId: string, originalKey: string): Promise<boolean>;
  getAsset(
    assetId: string,
  ): Promise<(AssetRecord & { ownerFirebaseUid: string; originalKey: string }) | null>;
  updateAssetState(
    assetId: string,
    expectedStates: AssetState[],
    state: AssetState,
    failureReason?: string | null,
  ): Promise<AssetRecord | null>;
}

export interface NewShareLink {
  projectId: string;
  ownerFirebaseUid: string;
  tokenHash: string;
  expiresAt: string | null;
  permissions: SharePermissions;
}

export interface ShareLinkRepository {
  createShareLink(input: NewShareLink): Promise<ShareLink | null>;
  listShareLinks(projectId: string): Promise<ShareLink[]>;
  getShareLink(shareLinkId: string): Promise<ShareLink | null>;
  getActiveShareLinkByTokenHash(tokenHash: string, now: Date): Promise<ShareLink | null>;
  updateShareLink(shareLinkId: string, input: UpdateShareLinkInput): Promise<ShareLink | null>;
  regenerateShareLink(shareLinkId: string, tokenHash: string): Promise<ShareLink | null>;
  revokeShareLink(shareLinkId: string): Promise<ShareLink | null>;
}

export interface DatabaseRepositories {
  users: UserRepository;
  projects: ProjectRepository;
  scenes: SceneRepository;
  assets: AssetRepository;
  uploadSessions: UploadSessionRepository;
  shares: ShareLinkRepository;
  ping(): Promise<void>;
  close(): Promise<void>;
}

export function createMongoRepositories(uri: string): DatabaseRepositories {
  const client = new MongoClient(uri);
  let collections:
    | Promise<{
        users: Collection<MongoUserDocument>;
        projects: Collection<MongoProjectDocument>;
        scenes: Collection<MongoSceneDocument>;
        assets: Collection<MongoAssetDocument>;
        uploadSessions: Collection<MongoUploadSessionDocument>;
        shares: Collection<MongoShareLinkDocument>;
      }>
    | undefined;

  async function getCollections() {
    collections ??= (async () => {
      await client.connect();
      const database = client.db();
      const users = database.collection<MongoUserDocument>('users');
      const projects = database.collection<MongoProjectDocument>('projects');
      const scenes = database.collection<MongoSceneDocument>('scenes');
      const assets = database.collection<MongoAssetDocument>('assets');
      const uploadSessions = database.collection<MongoUploadSessionDocument>('upload_sessions');
      const shares = database.collection<MongoShareLinkDocument>('share_links');
      await Promise.all([
        users.createIndex({ firebaseUid: 1 }, { unique: true }),
        projects.createIndex({ ownerFirebaseUid: 1, archivedAt: 1, updatedAt: -1 }),
        scenes.createIndex({ projectId: 1 }, { unique: true }),
        assets.createIndex({ projectId: 1, state: 1, updatedAt: -1 }),
        assets.createIndex({ ownerFirebaseUid: 1, projectId: 1 }),
        uploadSessions.createIndex({ assetId: 1 }, { unique: true }),
        uploadSessions.createIndex({ projectId: 1, ownerFirebaseUid: 1, state: 1 }),
        shares.createIndex({ tokenHash: 1 }, { unique: true }),
        shares.createIndex({ projectId: 1, createdAt: -1 }),
        shares.createIndex({ enabled: 1, revokedAt: 1, expiresAt: 1 }),
      ]);
      return { users, projects, scenes, assets, uploadSessions, shares };
    })();
    return collections;
  }

  return {
    async ping() {
      await client.connect();
      await client.db().command({ ping: 1 });
    },
    users: {
      async upsertFirebaseUser(user) {
        const { users } = await getCollections();
        const now = new Date();
        await users.updateOne(
          { firebaseUid: user.firebaseUid },
          { $set: { ...user, updatedAt: now }, $setOnInsert: { createdAt: now } },
          { upsert: true },
        );
        const stored = await users.findOne({ firebaseUid: user.firebaseUid });
        if (!stored) {
          throw new Error('User upsert did not return a user document.');
        }
        return toLocalUser(stored);
      },
    },
    projects: {
      async listOwnedProjects(ownerFirebaseUid) {
        const { projects, assets } = await getCollections();
        const stored = await projects
          .find({ ownerFirebaseUid, archivedAt: null })
          .sort({ updatedAt: -1 })
          .toArray();
        const projectIds = stored.map((project) => project._id);
        const storedAssets = projectIds.length
          ? await assets
              .find({ projectId: { $in: projectIds }, state: { $ne: 'DELETED' } })
              .sort({ updatedAt: -1 })
              .toArray()
          : [];
        const assetsByProject = new Map<string, MongoAssetDocument[]>();
        for (const asset of storedAssets) {
          const key = asset.projectId.toHexString();
          assetsByProject.set(key, [...(assetsByProject.get(key) ?? []), asset]);
        }
        return stored.map((project) =>
          toProjectSummary(project, assetsByProject.get(project._id.toHexString()) ?? []),
        );
      },
      async createProject(ownerFirebaseUid, input) {
        const { projects, scenes } = await getCollections();
        const now = new Date();
        const project: MongoProjectDocument = {
          _id: new ObjectId(),
          ownerFirebaseUid,
          name: input.name,
          archivedAt: null,
          createdAt: now,
          updatedAt: now,
        };
        await projects.insertOne(project);
        await scenes.insertOne({
          _id: new ObjectId(),
          projectId: project._id,
          ownerFirebaseUid,
          revision: 0,
          environmentAssetId: null,
          environmentTransform: {
            position: [0, 0, 0],
            quaternion: [0, 0, 0, 1],
            scale: [1, 1, 1],
          },
          variants: [],
          viewerSettings: { schemaVersion: 1, environmentVisible: true, buildingVisible: true },
          defaultCamera: null,
          createdAt: now,
          updatedAt: now,
        });
        return toProjectSummary(project);
      },
      async getProject(projectId) {
        const objectId = toObjectId(projectId);
        if (!objectId) {
          return null;
        }
        const { projects } = await getCollections();
        const project = await projects.findOne({ _id: objectId });
        return project
          ? { ...toProjectSummary(project), ownerFirebaseUid: project.ownerFirebaseUid }
          : null;
      },
      async updateProject(projectId, input) {
        const objectId = toObjectId(projectId);
        if (!objectId) {
          return null;
        }
        const { projects } = await getCollections();
        const result = await projects.findOneAndUpdate(
          { _id: objectId },
          { $set: { name: input.name, updatedAt: new Date() } },
          { returnDocument: 'after' },
        );
        return result ? toProjectSummary(result) : null;
      },
      async archiveProject(projectId) {
        const objectId = toObjectId(projectId);
        if (!objectId) {
          return null;
        }
        const { projects } = await getCollections();
        const result = await projects.findOneAndUpdate(
          { _id: objectId },
          { $set: { archivedAt: new Date(), updatedAt: new Date() } },
          { returnDocument: 'after' },
        );
        return result ? toProjectSummary(result) : null;
      },
      async deleteProject(projectId) {
        const objectId = toObjectId(projectId);
        if (!objectId) {
          return false;
        }
        const { projects, scenes, shares } = await getCollections();
        const deleted = await projects.deleteOne({ _id: objectId });
        if (deleted.deletedCount === 1) {
          await scenes.deleteMany({ projectId: objectId });
          await shares.deleteMany({ projectId: objectId });
          return true;
        }
        return false;
      },
    },
    scenes: {
      async getScene(projectId) {
        const objectId = toObjectId(projectId);
        if (!objectId) {
          return null;
        }
        const { scenes } = await getCollections();
        const stored = await scenes.findOne({ projectId: objectId });
        return stored ? toSceneRecord(stored) : null;
      },
      async updateScene(projectId, input) {
        const objectId = toObjectId(projectId);
        const environmentAssetId = input.environmentAssetId
          ? toObjectId(input.environmentAssetId)
          : null;
        if (!objectId || (input.environmentAssetId && !environmentAssetId)) {
          return null;
        }
        const { scenes } = await getCollections();
        const updated = await scenes.findOneAndUpdate(
          { projectId: objectId, revision: input.revision },
          {
            $set: {
              environmentAssetId,
              environmentTransform: input.environmentTransform,
              variants: input.variants,
              viewerSettings: input.viewerSettings,
              defaultCamera: input.defaultCamera,
              updatedAt: new Date(),
            },
            $inc: { revision: 1 },
          },
          { returnDocument: 'after' },
        );
        if (updated) {
          return toSceneRecord(updated);
        }
        return (await scenes.findOne({ projectId: objectId })) ? 'STALE' : null;
      },
    },
    assets: {
      async createAsset(ownerFirebaseUid, projectId, asset, originalKey) {
        const projectObjectId = toObjectId(projectId);
        if (!projectObjectId) {
          return null;
        }
        const { assets } = await getCollections();
        const now = new Date();
        const stored: MongoAssetDocument = {
          _id: new ObjectId(),
          projectId: projectObjectId,
          ownerFirebaseUid,
          ...asset,
          state: 'CREATED',
          originalKey,
          failureReason: null,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        };
        await assets.insertOne(stored);
        return toAssetRecord(stored);
      },
      async setAssetOriginalKey(assetId, originalKey) {
        const objectId = toObjectId(assetId);
        if (!objectId) {
          return false;
        }
        const { assets } = await getCollections();
        const result = await assets.updateOne(
          { _id: objectId, state: 'CREATED', originalKey: '' },
          { $set: { originalKey, updatedAt: new Date() } },
        );
        return result.modifiedCount === 1;
      },
      async getAsset(assetId) {
        const objectId = toObjectId(assetId);
        if (!objectId) {
          return null;
        }
        const { assets } = await getCollections();
        const stored = await assets.findOne({ _id: objectId });
        return stored
          ? {
              ...toAssetRecord(stored),
              ownerFirebaseUid: stored.ownerFirebaseUid,
              originalKey: stored.originalKey,
            }
          : null;
      },
      async updateAssetState(assetId, expectedStates, state, failureReason = null) {
        const objectId = toObjectId(assetId);
        if (!objectId) {
          return null;
        }
        const { assets } = await getCollections();
        const now = new Date();
        const stored = await assets.findOneAndUpdate(
          { _id: objectId, state: { $in: expectedStates } },
          {
            $set: {
              state,
              failureReason,
              deletedAt: state === 'DELETED' ? now : null,
              updatedAt: now,
            },
          },
          { returnDocument: 'after' },
        );
        return stored ? toAssetRecord(stored) : null;
      },
    },
    shares: {
      async createShareLink(input) {
        const projectId = toObjectId(input.projectId);
        if (!projectId) return null;
        const { shares } = await getCollections();
        const now = new Date();
        const stored: MongoShareLinkDocument = {
          _id: new ObjectId(),
          projectId,
          ownerFirebaseUid: input.ownerFirebaseUid,
          tokenHash: input.tokenHash,
          enabled: true,
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
          revokedAt: null,
          permissions: input.permissions,
          createdAt: now,
          updatedAt: now,
        };
        await shares.insertOne(stored);
        return toShareLink(stored);
      },
      async listShareLinks(projectId) {
        const objectId = toObjectId(projectId);
        if (!objectId) return [];
        const { shares } = await getCollections();
        const stored = await shares.find({ projectId: objectId }).sort({ createdAt: -1 }).toArray();
        return stored.map(toShareLink);
      },
      async getShareLink(shareLinkId) {
        const objectId = toObjectId(shareLinkId);
        if (!objectId) return null;
        const { shares } = await getCollections();
        const stored = await shares.findOne({ _id: objectId });
        return stored ? toShareLink(stored) : null;
      },
      async getActiveShareLinkByTokenHash(tokenHash, now) {
        const { shares } = await getCollections();
        const stored = await shares.findOne({
          tokenHash,
          enabled: true,
          revokedAt: null,
          $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
        });
        return stored ? toShareLink(stored) : null;
      },
      async updateShareLink(shareLinkId, input) {
        const objectId = toObjectId(shareLinkId);
        if (!objectId) return null;
        const { shares } = await getCollections();
        const update: Record<string, unknown> = { updatedAt: new Date() };
        if (input.enabled !== undefined) update.enabled = input.enabled;
        if (input.expiresAt !== undefined) {
          update.expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
        }
        if (input.permissions !== undefined) {
          const stored = await shares.findOne({ _id: objectId, revokedAt: null });
          if (!stored) return null;
          update.permissions = { ...stored.permissions, ...input.permissions };
        }
        const stored = await shares.findOneAndUpdate(
          { _id: objectId, revokedAt: null },
          { $set: update },
          { returnDocument: 'after' },
        );
        return stored ? toShareLink(stored) : null;
      },
      async regenerateShareLink(shareLinkId, tokenHash) {
        const objectId = toObjectId(shareLinkId);
        if (!objectId) return null;
        const { shares } = await getCollections();
        const stored = await shares.findOneAndUpdate(
          { _id: objectId, revokedAt: null },
          { $set: { tokenHash, enabled: true, updatedAt: new Date() } },
          { returnDocument: 'after' },
        );
        return stored ? toShareLink(stored) : null;
      },
      async revokeShareLink(shareLinkId) {
        const objectId = toObjectId(shareLinkId);
        if (!objectId) return null;
        const now = new Date();
        const { shares } = await getCollections();
        const stored = await shares.findOneAndUpdate(
          { _id: objectId, revokedAt: null },
          { $set: { enabled: false, revokedAt: now, updatedAt: now } },
          { returnDocument: 'after' },
        );
        return stored ? toShareLink(stored) : null;
      },
    },
    uploadSessions: {
      async createUploadSession(input) {
        const assetId = toObjectId(input.assetId);
        const projectId = toObjectId(input.projectId);
        if (!assetId || !projectId) {
          return null;
        }
        const { uploadSessions } = await getCollections();
        const now = new Date();
        const stored: MongoUploadSessionDocument = {
          _id: new ObjectId(),
          assetId,
          projectId,
          ownerFirebaseUid: input.ownerFirebaseUid,
          storageKey: input.storageKey,
          s3UploadId: input.s3UploadId,
          state: 'UPLOADING',
          partSize: input.partSize,
          totalParts: input.totalParts,
          parts: [],
          createdAt: now,
          updatedAt: now,
        };
        await uploadSessions.insertOne(stored);
        return toUploadSession(stored);
      },
      async getUploadSession(sessionId) {
        const objectId = toObjectId(sessionId);
        if (!objectId) {
          return null;
        }
        const { uploadSessions } = await getCollections();
        const stored = await uploadSessions.findOne({ _id: objectId });
        return stored
          ? {
              ...toUploadSession(stored),
              ownerFirebaseUid: stored.ownerFirebaseUid,
              storageKey: stored.storageKey,
              s3UploadId: stored.s3UploadId,
            }
          : null;
      },
      async recordPart(sessionId, part) {
        const objectId = toObjectId(sessionId);
        if (!objectId) {
          return null;
        }
        const { uploadSessions } = await getCollections();
        const stored = await uploadSessions.findOneAndUpdate(
          { _id: objectId, state: 'UPLOADING', 'parts.partNumber': { $ne: part.partNumber } },
          { $push: { parts: part }, $set: { updatedAt: new Date() } },
          { returnDocument: 'after' },
        );
        return stored ? toUploadSession(stored) : null;
      },
      async updateUploadSessionState(sessionId, expectedState, state) {
        const objectId = toObjectId(sessionId);
        if (!objectId) {
          return null;
        }
        const { uploadSessions } = await getCollections();
        const stored = await uploadSessions.findOneAndUpdate(
          { _id: objectId, state: expectedState },
          { $set: { state, updatedAt: new Date() } },
          { returnDocument: 'after' },
        );
        return stored ? toUploadSession(stored) : null;
      },
    },
    async close() {
      await client.close();
    },
  };
}

function toObjectId(value: string): ObjectId | null {
  return ObjectId.isValid(value) ? ObjectId.createFromHexString(value) : null;
}

function toLocalUser(document: MongoUserDocument): LocalUser {
  return {
    id: document._id.toHexString(),
    firebaseUid: document.firebaseUid,
    email: document.email,
    displayName: document.displayName,
    photoUrl: document.photoUrl,
    createdAt: document.createdAt.toISOString(),
    updatedAt: document.updatedAt.toISOString(),
  };
}

function toProjectSummary(
  document: MongoProjectDocument,
  assets: MongoAssetDocument[] = [],
): ProjectSummary {
  return {
    id: document._id.toHexString(),
    name: document.name,
    coverUrl: null,
    assetStatus:
      assets.length === 0
        ? 'NO_ASSETS'
        : assets.every((asset) => asset.state === 'READY')
          ? 'ASSETS_READY'
          : 'ASSETS_PENDING',
    shareStatus: 'NOT_SHARED',
    createdAt: document.createdAt.toISOString(),
    updatedAt: document.updatedAt.toISOString(),
    archivedAt: document.archivedAt?.toISOString() ?? null,
    assets: assets.map((asset) => ({
      id: asset._id.toHexString(),
      filename: asset.filename,
      kind: asset.kind,
      state: asset.state,
      size: asset.size,
    })),
  };
}

function toSceneRecord(document: MongoSceneDocument): SceneRecord {
  return {
    id: document._id.toHexString(),
    projectId: document.projectId.toHexString(),
    ownerFirebaseUid: document.ownerFirebaseUid,
    revision: document.revision,
    environmentAssetId: document.environmentAssetId?.toHexString() ?? null,
    environmentTransform: document.environmentTransform ?? {
      position: [0, 0, 0],
      quaternion: [0, 0, 0, 1],
      scale: [1, 1, 1],
    },
    variants: document.variants ?? [],
    viewerSettings: migrateViewerSettings(document.viewerSettings),
    defaultCamera: document.defaultCamera ?? null,
    createdAt: document.createdAt.toISOString(),
    updatedAt: document.updatedAt.toISOString(),
  };
}

function toAssetRecord(document: MongoAssetDocument): AssetRecord {
  return {
    id: document._id.toHexString(),
    projectId: document.projectId.toHexString(),
    kind: document.kind,
    state: document.state,
    filename: document.filename,
    contentType: document.contentType,
    size: document.size,
    checksumSha256: document.checksumSha256,
    failureReason: document.failureReason,
    createdAt: document.createdAt.toISOString(),
    updatedAt: document.updatedAt.toISOString(),
    deletedAt: document.deletedAt?.toISOString() ?? null,
  };
}

function toUploadSession(document: MongoUploadSessionDocument): UploadSession {
  return {
    id: document._id.toHexString(),
    assetId: document.assetId.toHexString(),
    projectId: document.projectId.toHexString(),
    state: document.state,
    partSize: document.partSize,
    totalParts: document.totalParts,
    parts: [...document.parts].sort((left, right) => left.partNumber - right.partNumber),
    createdAt: document.createdAt.toISOString(),
    updatedAt: document.updatedAt.toISOString(),
  };
}

function toShareLink(document: MongoShareLinkDocument): ShareLink {
  return {
    id: document._id.toHexString(),
    projectId: document.projectId.toHexString(),
    enabled: document.enabled,
    expiresAt: document.expiresAt?.toISOString() ?? null,
    revokedAt: document.revokedAt?.toISOString() ?? null,
    permissions: document.permissions,
    createdAt: document.createdAt.toISOString(),
    updatedAt: document.updatedAt.toISOString(),
  };
}
