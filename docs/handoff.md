# Handoff

## Phase 0: Architecture contracts

Implemented repository skeleton folders, architectural contracts, asset and security contracts, environment-variable contract and project rules.

Key decisions: accept `.spz` and direct `.ply` in the private MVP viewer; use metres, right-handed Y-up coordinates and rebased canonical quaternion transforms; warn on documented desktop and mobile budgets; use revision-based durable scene updates; keep asset storage private.

The selected current stable viewer dependencies are `three@0.185.1` and `@sparkjsdev/spark@2.1.0` (verified 2026-07-17). No dependencies are installed and no production functionality exists.

## Phase 1: Monorepo foundation

Implemented a pnpm 11.11.0 workspace with a React 19 and Vite 8 web application, an Express 5 API, shared TypeScript settings, Zod contracts and a shared environment-validation package. The web application checks the API through Vite's `/api` development proxy, and the API exposes `GET /health`.

Installed the current stable releases for the runtime stack and generated `pnpm-lock.yaml`. TypeScript is pinned to 6.0.2 rather than 7.0.2 because the current `typescript-eslint@8.64.0` support range ends before TypeScript 6.1; this keeps the required linting toolchain compatible.

New local defaults are `PORT=3001` and `WEB_ORIGIN=http://localhost:5173`; both are validated by `@gaussian-viewer/config`. No database migration or cloud configuration was introduced.

Verified commands: `pnpm install`, `pnpm run lint`, `pnpm run test`, `pnpm run build`, and the combined local API/Vite smoke test. Use `pnpm dev` for local development.

Next phase: build the local hybrid-viewer proof in Phase 2.

## Phase 2: Local hybrid-viewer proof

Implemented the reusable local viewer infrastructure in `packages/viewer-core` and connected it to the web application. It initializes a Three.js renderer, Spark 2.1.0 renderer, orbit controls, resize and disposal handling, local `.spz`/`.ply`/`.glb` file inputs, loading/error UI, visibility toggles, and environment position/Euler-rotation/uniform-scale controls. Alignment sliders are continuous spring-returning nudge controls with slow/fast rate selection and exact numeric entries. The building is loaded at its authored metre scale.

`docs/viewer-runtime.md` locks the exact Spark loader/renderer settings and desktop/mobile runtime budgets. The installed Spark 2.1.0 npm export is `SparkRenderer`; it is used with LoD enabled and normal Three.js scene rendering.

The viewer JavaScript bundle is currently 5.76 MB minified (1.99 MB gzip) because Three and Spark are loaded with the first page. This is an expected proof-stage limitation; defer bundle splitting and user-facing load polish to the investor-viewer phase unless real-asset measurements show it blocks the local proof.

Phase 2 is still in progress: a representative `.spz` or `.ply` and `.glb` are required to verify real loading, depth interaction, asset budgets and repeated browser memory/disposal behaviour. No asset was added or uploaded.

Next step: supply representative local assets and complete the Phase 2 verification gate.

## Phase 3: Authentication

Implemented Firebase Google sign-in, a frontend authentication context, authenticated API requests and logout handling. The API verifies Firebase ID tokens with the Firebase Admin SDK and upserts the authenticated identity into MongoDB using the Firebase UID as the unique external identity. The project routes now require this same middleware.

The browser Firebase configuration remains in root `.env` `VITE_FIREBASE_*` variables; server-only Admin SDK settings are `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL` and `FIREBASE_PRIVATE_KEY`. The server converts escaped newline sequences in the private key value when loading the environment. No private key or `.env` value is committed.

Verified: Google sign-in/sign-out and MongoDB user upsert were manually confirmed; automated lint, tests and production build passed.

Next phase: persistent projects and the owner dashboard.

## Phase 4: Projects and dashboard (implementation ready for manual acceptance)

Implemented MongoDB `projects` and initial `scenes` collections. Creating a project creates an empty scene record; active projects are listed in descending modified order. The API implements protected create, list, read, rename, archive and delete routes and verifies ownership before every single-project operation. Project summaries deliberately expose only the Phase 4 placeholders: no cover URL, no assets and not shared.

The web application now has `/projects`, `/projects/:id/settings` and `/projects/:id/editor`. The dashboard has a creation dialog, cover placeholder, last-modified timestamp, asset/share status and archive/delete actions. Settings currently supports renaming, and the editor route is intentionally empty until its later phase.

Automated checks passed: `pnpm run build`, `pnpm run lint`, and `pnpm run test`. The API tests cover owner-scoped lists, creation, validation, rename and a `403` response for another user's direct project request.

Manual acceptance still needed: create a project, reload and sign out/in, rename it in Settings, archive it, and open its Editor route. Once confirmed, mark Phase 4 complete.

## Phase 5: Asset records and private S3 (implementation complete; existing-bucket acceptance pending)

Implemented the private direct-upload workflow. The API creates an owner- and project-scoped immutable asset
record, generates its S3 key server-side, returns a 10-minute presigned PUT URL and never receives the file
body. The browser computes a SHA-256 checksum, uploads directly to S3 and calls completion. Completion reads
only object metadata and a 32-byte range from S3 to verify existence, exact size, SHA-256 and the GLB, PLY or
SPZ signature before the asset can reach `READY`. Download URLs are owner-scoped, signed for five minutes and
only available for `READY` assets. Deletion is a soft transition to `DELETED`; keys are immutable and are not
reused.

The direct route is intentionally capped at 100 MB for smaller GLB and test assets. The owner editor contains
the resulting upload, temporary download and delete controls; multipart/resume/progress capabilities remain
strictly deferred to Phase 6. Shared contracts now include all lifecycle states (`CREATED`, `UPLOADING`,
`UPLOADED`, `VALIDATING`, `READY`, `FAILED`, `DELETED`) and database indexes cover project and owner scopes.

Phase 5 now targets the existing main-application S3 bucket. Set its region and name through the uncommitted
AWS environment values, grant the API the required object permissions only for the `projects/*` prefix and add
the application origin to its CORS configuration. The CloudFormation template remains an optional fallback for
a later isolated bucket. Automated lint, tests and production builds pass; tests cover the owner-scoped
presigned upload, transition to `READY`, temporary download and soft deletion. Manual acceptance is still
required against the configured bucket: upload a representative small file, confirm the unsigned S3 object URL
is denied, and confirm a `READY` temporary link works then expires.

Next phase: multipart uploads for large splats.

## Phase 6: Multipart uploads for large splats (implementation complete; lifecycle and live acceptance pending)

Implemented owner-scoped S3 multipart uploads for PLY and SPZ environments above 100 MB. A 16 MB part size
keeps each browser checksum bounded in memory and remains safely above S3's non-final minimum. `upload_sessions`
store the S3 upload ID and immutable storage key internally plus part numbers, ETags, per-part SHA-256 values
and byte sizes. The browser uploads parts directly to S3, displays recorded-part progress, retries each failed
part three times, saves the session ID locally and resumes skipped parts after a refresh when the same file is
reselected. Users can explicitly abort an active session.

Completion sends the recorded part ETags and checksums to S3, then validates the resulting object's size,
S3 checksum metadata and magic bytes before it can become `READY`. The existing bucket needs the supplied
seven-day incomplete-multipart lifecycle rule merged into its existing lifecycle configuration; see
`infra/aws/existing-bucket-lifecycle.json` and `infra/aws/README.md`. Automated checks pass. Manual acceptance
still needs a representative large environment upload, refresh/reselect resume, an induced part retry, explicit
abort and verification that S3 removes an abandoned multipart upload after seven days.

Next phase: scene manifest and persistent editor state.

## Phase 7: Scene manifest and persistent editor state (implementation complete; live acceptance pending)

Implemented the authenticated project manifest and revision-checked scene update endpoints. Owner manifests resolve only ready environment asset keys to short-lived download URLs and expose the scene reconstruction shape, including reserved empty variant and annotation lists for their later phases. MongoDB retains S3 object keys only.

The editor loads the manifest and scene asset before applying visibility preferences and the saved opening camera. Viewer visibility changes are debounced, optimistically reflected, and serialized so a later local change cannot be overwritten by an earlier response. A `409 Conflict` stops further durable changes, preserves the server-side revision, and offers an explicit reload rather than silently overwriting another tab's update. Camera movement remains viewer-only until **Save opening camera** explicitly persists position, controls target and field of view.

Pre-versioned viewer settings migrate to schema version 1; unsupported incoming versions receive a clear `400` response. Automated contracts and API tests cover migration, resolved manifests, persisted cameras, validation and stale-revision rejection. The web production build also passes.

Manual acceptance still needs the configured Firebase/MongoDB/S3 environment: create a project with a ready environment asset, change visibility and reload, save/reopen an opening camera, then repeat a change from two browser tabs and confirm the stale tab is prompted to reload.

Next phase: continue the full scene editor from the persisted first-building foundation.

## Phase 8: Persisted first-building foundation (historical checkpoint)

Started the first bounded implementation task. A scene now persists at most one building variant with its canonical
transform inside the existing revision-checked scene write. The API accepts only a ready, project-owned GLB,
derives the variant ID from the immutable asset ID and resolves it to a short-lived owner-manifest URL. The editor
can apply a newly uploaded ready environment or GLB to the scene, then reloads both private assets from the saved
manifest; scene reload clears previous runtime assets first.

The embedded first variant is deliberate: its placement changes atomically with the scene revision. Do not add
separate variant persistence without preserving this stale-write protection. At this checkpoint, selection,
transform gizmos, numeric alignment inputs, opacity/wireframe, proxy ground and current-session undo/reset were
still pending Phase 8 work.

Verified for this task: contracts, viewer-core and API tests; database, viewer-core, API and web production builds.

Next step: add the selected-object transform editor (numeric values and gizmos) while persisting only canonical
position/quaternion/positive-scale transforms through the existing revision queue.

## Phase 8: Owner flow and numeric alignment update

The web entry point now starts with sign-in for unauthenticated visitors and opens the authenticated user's project
list after session verification. The top navigation shows the signed-in identity everywhere in the owner area and,
inside an editor, adds the project name and a Projects back link. Project cards list their associated uploaded asset
records and keep destructive deletion on the card itself. Project renaming is now available directly in the editor.

The editor combines private asset upload, the persisted project viewer, visibility toggles and **Save opening camera**
in one workspace. It restores the saved environment/building transforms and opening camera from the owner manifest.
Numeric position, Euler-rotation and scale inputs update the live scene and are debounced into the existing
revision-checked scene queue; building transforms retain their canonical non-uniform scale while the Spark
environment remains uniform-scale. The old local proof viewer is retained only as an unlinked Phase 2 harness.

Anonymous `/share/{token}` presentation remains Phase 10 work: it requires its separate public manifest and
share-token security boundary, so no public asset or viewer route was introduced here.

## Phase 8: Full scene editor (implementation complete; live acceptance pending)

Completed the remaining private owner-editor controls. The owner selects the environment or the first building,
then uses a Three.js move/rotate gizmo or the synchronized numeric position, Euler rotation and scale fields.
Gizmo changes are converted back to the canonical position/quaternion/positive-scale transform before entering
the existing revision-checked save queue. Undo and reset operate on transforms loaded during the current browser
session; reset is itself undoable. The editor also supplies local-only building opacity/wireframe and proxy-ground
controls.

Only durable scene transforms, visibility preferences, selected assets and explicitly saved opening camera enter
MongoDB. Selected object, gizmo mode, display controls and edit-session history remain browser-local. This
preserves the one-variant revision boundary and does not introduce any Phase 9 variant storage or Phase 10 public
surface.

Verified: full workspace formatting and lint, tests, TypeScript type-check and production builds. Live acceptance
needs a ready environment and GLB to verify gizmo interaction, reload persistence, undo/reset and the proxy
ground in a browser.
