# Architecture

## System boundary

The product is a TypeScript pnpm monorepo. `apps/web` is a React and Vite client, `apps/api` is an Express API, and `apps/worker` is a future background processor. Shared packages own contracts, viewer code, database access, storage access, authentication helpers and environment validation.

MongoDB Atlas stores structured project data. Private Amazon S3 stores all binary assets. Firebase Authentication proves the owner identity. The API verifies Firebase ID tokens and issues short-lived storage URLs. CloudFront is introduced only when production-scale private delivery is required.

## Runtime boundaries

- The web client never receives storage credentials and never sends binary assets through Express.
- The API owns authorization, asset-key generation, persistence and manifest shaping.
- The worker may validate or transform assets, but does not serve browser traffic.
- The viewer consumes a resolved manifest containing temporary asset URLs; MongoDB only stores stable S3 keys.

## Viewer technology decision

The MVP viewer uses `three@0.185.1` and `@sparkjsdev/spark@2.1.0`, current stable npm releases verified on 2026-07-17. Spark is the selected splat renderer because it integrates splats into a Three.js scene alongside GLB meshes.

The dependency versions are centrally recorded in `pnpm-workspace.yaml`. Phase 2 must verify their compatibility in a browser before further viewer work.

## Package ownership

| Package                | Responsibility                                        |
| ---------------------- | ----------------------------------------------------- |
| `packages/contracts`   | Zod schemas and shared payload types                  |
| `packages/viewer-core` | Renderer lifecycle, asset loading and viewer controls |
| `packages/database`    | MongoDB models and repositories                       |
| `packages/storage`     | Private S3 and future CloudFront abstraction          |
| `packages/auth`        | Firebase token verification helpers                   |
| `packages/config`      | Environment parsing and validation                    |

## Non-goals for Phase 0

No app code, persistent database, authentication setup, cloud resources or asset-processing pipeline is created in this phase.
