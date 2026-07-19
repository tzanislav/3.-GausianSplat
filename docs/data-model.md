# Data model

All documents use immutable IDs, ISO-8601 timestamps and a `schemaVersion` when their nested settings may evolve. Binary files are represented by asset metadata and S3 keys only.

## Core entities

| Entity          | Required fields                                                                                                  | Notes                                  |
| --------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| User            | `id`, `firebaseUid`, `createdAt`                                                                                 | `firebaseUid` is unique.               |
| Project         | `id`, `ownerFirebaseUid`, `name`, `archivedAt?`, `createdAt`, `updatedAt`                                        | Owns scenes and share links.           |
| Scene           | `id`, `projectId`, `revision`, `environmentAssetId?`, `environmentTransform`, `defaultCamera?`, `viewerSettings` | `revision` rejects stale writes.       |
| Asset           | `id`, `projectId`, `ownerId`, `kind`, `state`, `originalKey?`, `runtimeKey?`, `metadata`                         | Represents one immutable binary asset. |
| Variant         | `id`, `sceneId`, `assetId`, `name`, `transform`, `visible`, `displayOrder`                                       | Points to a GLB asset.                 |
| Camera bookmark | `id`, `sceneId`, `name`, `position`, `target`, `fov`, `displayOrder`                                             | Presentation state.                    |
| Annotation      | `id`, `sceneId`, `position`, `title`, `description`, `visibility`                                                | Can be excluded from sharing.          |
| Share link      | `id`, `projectId`, `tokenHash`, `enabled`, `expiresAt?`, `permissions`                                           | Never store the plaintext token.       |
| Upload session  | `id`, `assetId`, `storageKey`, `state`, `parts`                                                                  | Added with multipart uploads.          |

## Phase 5 asset record

An asset stores its immutable original S3 key internally as `originalKey`; API responses expose neither
that key nor a permanent URL. It also stores the owner Firebase UID, source filename, derived content type,
expected byte size, SHA-256 checksum, lifecycle state and an optional validation failure reason. Asset IDs
are part of their server-generated keys, so a replacement always receives a new key and cannot overwrite a
deleted asset.

## Phase 6 upload session

`upload_sessions` persists the asset/project/owner scope, immutable storage key, S3 upload ID, 16 MB part size,
total part count and recorded `{ partNumber, etag, checksumSha256, size }` values. The S3 upload ID and storage
key are API-only. A session is `UPLOADING`, `COMPLETED` or `ABORTED`; part numbers cannot be recorded twice.
An owner resume request exposes only the recorded part metadata, allowing the browser to skip completed chunks
after the user reselects the same local file.

## Transform value

Every persisted transform has this shape:

```json
{
  "position": [0, 0, 0],
  "quaternion": [0, 0, 0, 1],
  "scale": [1, 1, 1]
}
```

Arrays are finite numbers. Quaternion values must be normalized before persistence and scale components must be greater than zero.

## Scene revisions

The client includes the last-read `revision` in every durable scene update. The API applies the update only when it matches the stored revision, increments it atomically, and otherwise returns `409 Conflict`. Phase 8 persists the single supported building variant within the scene document and includes it in that same revision-checked update; variants will be moved to their own collection only if the later multi-variant feature requires it. Camera pose while navigating, selected object, gizmo mode, opacity, wireframe, proxy-ground visibility and current-session undo history are viewer-only state and do not update the scene revision. Selecting **Save opening camera** is an explicit durable scene update and stores a `defaultCamera`.

## Default camera

```json
{
  "position": [6, 4, 6],
  "target": [0, 1, 0],
  "fov": 55
}
```

`defaultCamera` is optional. When present, the client applies its position, orbit-controls target and field of view after the scene manifest's assets are ready. It is distinct from temporary navigation pose and from named camera bookmarks. Only an explicit owner save changes it.
