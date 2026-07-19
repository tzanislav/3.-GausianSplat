# API contract

## Contract ownership

`packages/contracts` will own request and response schemas once it is created in Phase 1. The API must expose separate authenticated-owner and anonymous-public manifest contracts; public responses must never be a filtered object assembled ad hoc in the client.

## Initial endpoint plan

| Phase | Endpoint family                   | Purpose                                                   |
| ----- | --------------------------------- | --------------------------------------------------------- |
| 1     | `GET /health`                     | Process health check                                      |
| 3     | `/auth` middleware                | Firebase ID-token verification                            |
| 4     | `/projects`                       | Owner project CRUD                                        |
| 5–6   | `/assets`, `/uploads`             | Presigned and multipart asset upload workflows            |
| 7     | `/projects/{id}/manifest`         | Authenticated scene reconstruction                        |
| 7     | `/scenes/{id}`                    | Revision-checked scene updates, including `defaultCamera` |
| 8     | `/projects/{id}/scene`            | Revision-checked environment and first-building placement |
| 10    | `/public/shares/{token}/manifest` | Sanitized anonymous read-only viewing                     |

## Phase 8 owner scene updates

The existing `PUT /projects/{projectId}/scene` payload now carries at most one building variant. The API accepts
only a `READY`, project-owned `BUILDING` asset, derives the persistent variant ID from that immutable asset ID and
persists its canonical transform in the same revision-checked scene write as the environment transform. Owner
manifests resolve each ready building to a short-lived download URL; no object key is exposed.

## Phase 5 owner asset endpoints

All routes require a Firebase ID token and a project owned by that identity. Object keys are internal and
are never accepted from or returned to the browser.

| Endpoint                                               | Purpose                                                                                                                |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `POST /projects/{projectId}/assets/uploads`            | Creates an immutable asset record and returns a 10-minute presigned PUT URL, required content headers and an asset ID. |
| `POST /projects/{projectId}/assets/{assetId}/complete` | Verifies S3 object existence, exact byte length, SHA-256 checksum and file signature before returning `READY`.         |
| `GET /projects/{projectId}/assets/{assetId}/download`  | Returns a 5-minute presigned GET URL for a `READY` asset.                                                              |
| `DELETE /projects/{projectId}/assets/{assetId}`        | Soft-deletes the record; storage cleanup is intentionally delayed.                                                     |

The direct upload limit is 100 MB. Supported inputs are `.glb` for buildings and `.ply` or `.spz` for
environments. The client SHA-256 value is sent both to the API and as the signed S3 checksum header.

## Phase 6 multipart owner endpoints

Multipart uploads are for `.ply` and `.spz` environment files above 100 MB. Each 16 MB browser part receives
its own signed URL and SHA-256 checksum header. The browser records S3's exposed `ETag` only after a successful
part upload, so an interrupted upload can resume by reselecting the same file after a refresh.

| Endpoint                                                                | Purpose                                                                                      |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `POST /projects/{projectId}/uploads/multipart`                          | Creates an asset, starts an S3 multipart upload and returns a persisted upload session.      |
| `GET /projects/{projectId}/uploads/{sessionId}`                         | Returns recorded parts for owner-only resume.                                                |
| `POST /projects/{projectId}/uploads/{sessionId}/parts/{partNumber}/url` | Returns a signed URL for one unrecorded part.                                                |
| `POST /projects/{projectId}/uploads/{sessionId}/parts/{partNumber}`     | Persists the part number, size, SHA-256 and S3 ETag.                                         |
| `POST /projects/{projectId}/uploads/{sessionId}/complete`               | Completes S3 multipart upload, then validates size, S3 checksum metadata and file signature. |
| `DELETE /projects/{projectId}/uploads/{sessionId}`                      | Explicitly aborts S3 multipart upload and marks the asset deleted.                           |
