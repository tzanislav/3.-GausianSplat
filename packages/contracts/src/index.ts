import { z } from 'zod';

export const TransformSchema = z.object({
  position: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]),
  quaternion: z.tuple([
    z.number().finite(),
    z.number().finite(),
    z.number().finite(),
    z.number().finite(),
  ]),
  scale: z.tuple([z.number().positive(), z.number().positive(), z.number().positive()]),
});

export const AssetStateSchema = z.enum([
  'CREATED',
  'UPLOADING',
  'UPLOADED',
  'VALIDATING',
  'READY',
  'FAILED',
  'DELETED',
]);
export const AssetKindSchema = z.enum(['ENVIRONMENT', 'BUILDING']);

export const CreateAssetUploadInputSchema = z.object({
  kind: AssetKindSchema,
  filename: z.string().trim().min(1).max(255),
  size: z.number().int().positive(),
  checksumSha256: z.string().regex(/^[A-Za-z0-9+/]{43}=$/),
});

export const CreateMultipartUploadInputSchema = z.object({
  kind: z.literal('ENVIRONMENT'),
  filename: z.string().trim().min(1).max(255),
  size: z.number().int().positive(),
});

export const MultipartPartUrlInputSchema = z.object({
  checksumSha256: z.string().regex(/^[A-Za-z0-9+/]{43}=$/),
});

export const RecordMultipartPartInputSchema = MultipartPartUrlInputSchema.extend({
  etag: z.string().min(1).max(256),
  size: z.number().int().positive(),
});

export const UploadSessionStateSchema = z.enum(['UPLOADING', 'COMPLETED', 'ABORTED']);

export const UploadPartSchema = z.object({
  partNumber: z.number().int().positive(),
  etag: z.string().min(1),
  checksumSha256: z.string().regex(/^[A-Za-z0-9+/]{43}=$/),
  size: z.number().int().positive(),
});

export const UploadSessionSchema = z.object({
  id: z.string().min(1),
  assetId: z.string().min(1),
  projectId: z.string().min(1),
  state: UploadSessionStateSchema,
  partSize: z.number().int().positive(),
  totalParts: z.number().int().positive(),
  parts: z.array(UploadPartSchema),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const MultipartUploadSessionTicketSchema = UploadSessionSchema.extend({
  assetId: z.string().min(1),
});

export const MultipartPartUrlTicketSchema = z.object({
  url: z.string().url(),
  headers: z.object({
    'x-amz-checksum-sha256': z.string().regex(/^[A-Za-z0-9+/]{43}=$/),
  }),
  expiresAt: z.string().datetime(),
});

export const AssetUploadTicketSchema = z.object({
  assetId: z.string().min(1),
  state: z.literal('UPLOADING'),
  uploadUrl: z.string().url(),
  headers: z.object({
    'content-type': z.string().min(1),
    'x-amz-checksum-sha256': z.string().regex(/^[A-Za-z0-9+/]{43}=$/),
  }),
  expiresAt: z.string().datetime(),
});

export const AssetRecordSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  kind: AssetKindSchema,
  state: AssetStateSchema,
  filename: z.string().min(1),
  contentType: z.string().min(1),
  size: z.number().int().positive(),
  checksumSha256: z
    .string()
    .regex(/^[A-Za-z0-9+/]{43}=$/)
    .nullable(),
  failureReason: z.string().min(1).nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable(),
});

export const AssetReferenceSchema = z.object({
  id: z.string().min(1),
  kind: AssetKindSchema,
  state: AssetStateSchema,
});

export const ReadyAssetReferenceSchema = AssetReferenceSchema.extend({
  state: z.literal('READY'),
});

export const FirebaseUserSchema = z.object({
  firebaseUid: z.string().min(1),
  email: z.string().email().nullable(),
  displayName: z.string().min(1).nullable(),
  photoUrl: z.string().url().nullable(),
});

export const LocalUserSchema = FirebaseUserSchema.extend({
  id: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const ProjectSettingsInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
});

export const CreateProjectInputSchema = ProjectSettingsInputSchema;

export const ProjectCoverUploadInputSchema = z.object({
  size: z
    .number()
    .int()
    .positive()
    .max(5 * 1024 * 1024),
  checksumSha256: z.string().regex(/^[A-Za-z0-9+/]{43}=$/),
});

export const ProjectCoverUploadTicketSchema = z.object({
  uploadUrl: z.string().url(),
  headers: z.object({
    'content-type': z.literal('image/webp'),
    'x-amz-checksum-sha256': z.string().regex(/^[A-Za-z0-9+/]{43}=$/),
  }),
  expiresAt: z.string().datetime(),
});

export const ProjectSummarySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  coverUrl: z.string().url().nullable(),
  assetStatus: z.enum(['NO_ASSETS', 'ASSETS_PENDING', 'ASSETS_READY']),
  shareStatus: z.enum(['NOT_SHARED']),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  archivedAt: z.string().datetime().nullable(),
  unreadAnnotationCommentCount: z.number().int().nonnegative().default(0),
  assets: z.array(
    z.object({
      id: z.string().min(1),
      filename: z.string().min(1),
      kind: AssetKindSchema,
      state: AssetStateSchema,
      size: z.number().int().positive(),
    }),
  ),
});

export const SkySettingsSchema = z.object({
  visible: z.boolean().default(true),
  rotationYDegrees: z.number().finite().default(0),
});

export const LightColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const SunLightSettingsSchema = z.object({
  power: z.number().finite().nonnegative().default(2.5),
  color: LightColorSchema.default('#ffffff'),
  rotationDegrees: z
    .tuple([z.number().finite(), z.number().finite(), z.number().finite()])
    .default([0, 0, 0]),
});

export const AmbientLightSettingsSchema = z.object({
  power: z.number().finite().nonnegative().default(1.8),
  color: LightColorSchema.default('#ffffff'),
});

export const LightingSettingsSchema = z.object({
  sun: SunLightSettingsSchema.default({ power: 2.5, color: '#ffffff', rotationDegrees: [0, 0, 0] }),
  ambient: AmbientLightSettingsSchema.default({ power: 1.8, color: '#ffffff' }),
});

export const ViewerSettingsSchema = z.object({
  schemaVersion: z.literal(3),
  environmentVisible: z.boolean().default(true),
  buildingVisible: z.boolean().default(true),
  sky: SkySettingsSchema.default({ visible: true, rotationYDegrees: 0 }),
  lighting: LightingSettingsSchema.default({
    sun: { power: 2.5, color: '#ffffff', rotationDegrees: [0, 0, 0] },
    ambient: { power: 1.8, color: '#ffffff' },
  }),
});

/**
 * Migrate the pre-versioned Phase 4–6 scene shape and versions 1–2 settings to the current
 * durable viewer-settings version. Later unknown versions deliberately fail instead of being
 * silently rewritten.
 */
export function migrateViewerSettings(value: unknown): ViewerSettings {
  if (value === undefined || value === null) {
    return ViewerSettingsSchema.parse({ schemaVersion: 3 });
  }
  if (typeof value === 'object' && !Array.isArray(value) && !('schemaVersion' in value)) {
    return ViewerSettingsSchema.parse({ ...value, schemaVersion: 3 });
  }
  if (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    'schemaVersion' in value &&
    (value.schemaVersion === 1 || value.schemaVersion === 2)
  ) {
    return ViewerSettingsSchema.parse({ ...value, schemaVersion: 3 });
  }
  return ViewerSettingsSchema.parse(value);
}

export const DefaultCameraSchema = z.object({
  position: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]),
  target: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]),
  fov: z.number().finite().min(10).max(120),
});

export const SceneVariantSchema = z.object({
  id: z.string().min(1),
  assetId: z.string().min(1),
  name: z.string().min(1),
  transform: TransformSchema,
  visible: z.boolean(),
  displayOrder: z.number().int().nonnegative(),
});

export const SceneAnnotationSchema = z.object({
  id: z.string().min(1),
  position: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]),
  title: z.string().trim().min(1).max(120),
  description: z.string().max(4_000),
  color: LightColorSchema.default('#78b8f6'),
  labelOffset: z
    .tuple([z.number().finite(), z.number().finite(), z.literal(0)])
    .default([16, -8, 0]),
  visibility: z.enum(['PRIVATE', 'PUBLIC']),
});

export const CreateAnnotationCommentInputSchema = z.object({
  body: z.string().trim().min(1).max(2_000),
});

export const AnnotationCommentSchema = z.object({
  id: z.string().min(1),
  annotationId: z.string().min(1),
  body: z.string().min(1),
  createdAt: z.string().datetime(),
  readAt: z.string().datetime().nullable(),
});

export const SceneUpdateInputSchema = z.object({
  revision: z.number().int().nonnegative(),
  environmentAssetId: z.string().min(1).nullable(),
  environmentTransform: TransformSchema,
  variants: z.array(SceneVariantSchema).max(1),
  viewerSettings: ViewerSettingsSchema,
  defaultCamera: DefaultCameraSchema.nullable(),
  annotations: z.array(SceneAnnotationSchema).max(100).default([]),
  annotationScale: z.number().finite().positive().max(100).default(10),
});

export const SceneManifestSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  revision: z.number().int().nonnegative(),
  environment: ReadyAssetReferenceSchema.optional(),
  environmentTransform: TransformSchema,
  variants: z.array(SceneVariantSchema).max(1),
  viewerSettings: ViewerSettingsSchema,
  defaultCamera: DefaultCameraSchema.nullable(),
  annotations: z.array(SceneAnnotationSchema),
  annotationScale: z.number().finite().positive().max(100).default(10),
});

export const OwnerSceneVariantSchema = SceneVariantSchema.extend({
  url: z.string().url(),
  filename: z.string().min(1),
});

export const OwnerSceneManifestSchema = SceneManifestSchema.extend({
  environment: ReadyAssetReferenceSchema.extend({
    url: z.string().url(),
    filename: z.string().min(1),
  }).optional(),
  variants: z.array(OwnerSceneVariantSchema).max(1),
});

export const SharePermissionsSchema = z.object({
  allowVariantSwitching: z.boolean().default(true),
  showAnnotations: z.boolean().default(true),
  showProjectDescription: z.boolean().default(true),
  showTechnicalInformation: z.boolean().default(false),
});

export const CreateShareLinkInputSchema = z.object({
  expiresAt: z.string().datetime().nullable().optional(),
  permissions: SharePermissionsSchema.partial().optional(),
});

export const UpdateShareLinkInputSchema = z
  .object({
    enabled: z.boolean().optional(),
    expiresAt: z.string().datetime().nullable().optional(),
    permissions: SharePermissionsSchema.partial().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'At least one share link field is required.');

export const ShareLinkSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  enabled: z.boolean(),
  expiresAt: z.string().datetime().nullable(),
  revokedAt: z.string().datetime().nullable(),
  permissions: SharePermissionsSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const PublicAssetFormatSchema = z.enum(['PLY', 'SPZ', 'GLB']);

export const PublicRuntimeAssetSchema = z.object({
  url: z.string().url(),
  format: PublicAssetFormatSchema,
});

export const PublicSceneVariantSchema = z.object({
  name: z.string().min(1),
  transform: TransformSchema,
  visible: z.boolean(),
  displayOrder: z.number().int().nonnegative(),
  asset: PublicRuntimeAssetSchema,
});

/** A deliberately separate contract that never includes owner or storage metadata. */
export const PublicShareManifestSchema = z.object({
  project: z.object({ name: z.string().min(1) }),
  permissions: SharePermissionsSchema,
  environment: PublicRuntimeAssetSchema.optional(),
  environmentTransform: TransformSchema,
  variants: z.array(PublicSceneVariantSchema).max(1),
  viewerSettings: ViewerSettingsSchema,
  defaultCamera: DefaultCameraSchema.nullable(),
  annotations: z.array(SceneAnnotationSchema),
  annotationScale: z.number().finite().positive().max(100).default(10),
});

export type Transform = z.infer<typeof TransformSchema>;
export type AssetState = z.infer<typeof AssetStateSchema>;
export type AssetKind = z.infer<typeof AssetKindSchema>;
export type CreateAssetUploadInput = z.infer<typeof CreateAssetUploadInputSchema>;
export type CreateMultipartUploadInput = z.infer<typeof CreateMultipartUploadInputSchema>;
export type MultipartPartUrlInput = z.infer<typeof MultipartPartUrlInputSchema>;
export type RecordMultipartPartInput = z.infer<typeof RecordMultipartPartInputSchema>;
export type UploadSessionState = z.infer<typeof UploadSessionStateSchema>;
export type UploadPart = z.infer<typeof UploadPartSchema>;
export type UploadSession = z.infer<typeof UploadSessionSchema>;
export type MultipartUploadSessionTicket = z.infer<typeof MultipartUploadSessionTicketSchema>;
export type MultipartPartUrlTicket = z.infer<typeof MultipartPartUrlTicketSchema>;
export type AssetUploadTicket = z.infer<typeof AssetUploadTicketSchema>;
export type AssetRecord = z.infer<typeof AssetRecordSchema>;
export type AssetReference = z.infer<typeof AssetReferenceSchema>;
export type ReadyAssetReference = z.infer<typeof ReadyAssetReferenceSchema>;
export type FirebaseUser = z.infer<typeof FirebaseUserSchema>;
export type LocalUser = z.infer<typeof LocalUserSchema>;
export type ProjectSettingsInput = z.infer<typeof ProjectSettingsInputSchema>;
export type CreateProjectInput = z.infer<typeof CreateProjectInputSchema>;
export type ProjectCoverUploadInput = z.infer<typeof ProjectCoverUploadInputSchema>;
export type ProjectCoverUploadTicket = z.infer<typeof ProjectCoverUploadTicketSchema>;
export type ProjectSummary = z.infer<typeof ProjectSummarySchema>;
export type ViewerSettings = z.infer<typeof ViewerSettingsSchema>;
export type DefaultCamera = z.infer<typeof DefaultCameraSchema>;
export type SceneVariant = z.infer<typeof SceneVariantSchema>;
export type OwnerSceneVariant = z.infer<typeof OwnerSceneVariantSchema>;
export type SceneAnnotation = z.infer<typeof SceneAnnotationSchema>;
export type CreateAnnotationCommentInput = z.infer<typeof CreateAnnotationCommentInputSchema>;
export type AnnotationComment = z.infer<typeof AnnotationCommentSchema>;
export type SceneUpdateInput = z.infer<typeof SceneUpdateInputSchema>;
export type SceneManifest = z.infer<typeof SceneManifestSchema>;
export type OwnerSceneManifest = z.infer<typeof OwnerSceneManifestSchema>;
export type SharePermissions = z.infer<typeof SharePermissionsSchema>;
export type CreateShareLinkInput = z.infer<typeof CreateShareLinkInputSchema>;
export type UpdateShareLinkInput = z.infer<typeof UpdateShareLinkInputSchema>;
export type ShareLink = z.infer<typeof ShareLinkSchema>;
export type PublicAssetFormat = z.infer<typeof PublicAssetFormatSchema>;
export type PublicRuntimeAsset = z.infer<typeof PublicRuntimeAssetSchema>;
export type PublicSceneVariant = z.infer<typeof PublicSceneVariantSchema>;
export type PublicShareManifest = z.infer<typeof PublicShareManifestSchema>;
