# Locked architecture

> Progress note: whenever implementation work is completed, update this document to mark the relevant steps and acceptance criteria as completed so the plan stays accurate.

Given your existing stack, I would standardize on:

```text
Frontend          React + TypeScript + Vite
3D rendering      Three.js + Spark
API               Node.js + Express + TypeScript
Database          MongoDB Atlas
Authentication    Firebase Authentication
Large files       Private Amazon S3 bucket
CDN               CloudFront, added near production
Background work   Separate Node worker, added after MVP
```

Spark integrates Gaussian splats into a normal Three.js scene hierarchy alongside GLB meshes, which is exactly what the hybrid architectural viewer needs. ([SparkJS][1])

## Additional planning guardrails from the architecture review

The following items should be treated as explicit design constraints before the project moves beyond the local viewer proof:

* Define the MVP runtime splat formats now. The private MVP accepts Spark-compatible `.spz` and direct `.ply`; `.spz` is the preferred compressed delivery format.
* Define runtime budgets for the viewer: maximum download size, maximum splat count, maximum GLB size/triangle count, maximum texture memory, and safe desktop/mobile targets.
* Lock down the transform contract now: canonical position/quaternion/scale, project-origin rebasing, right-handed coordinate space, and a single unit convention.
* Define the asset lifecycle states explicitly: `UPLOADED`, `VALIDATING`, `READY`, `FAILED`, and `DELETED`. A file is not `READY` until it passes basic validation and metadata checks.
* Treat scene persistence and viewer-only state as separate concerns. The editor should use revision-based updates so stale writes and cross-tab overwrites are rejected rather than silently merged.
* Define share-link revocation semantics clearly: either immediate revocation for all future manifests or an explicit bounded window driven by short-lived asset URLs.
* Keep public manifests and owner manifests as distinct contracts, and redact share tokens from logs and telemetry.
* Keep storage delivery behind a single abstraction so S3, CloudFront, signed URLs and signed cookies can be introduced without rewriting the viewer.

## What is stored where

### MongoDB: project state and metadata

MongoDB stores small structured information:

* Users
* Projects
* Scenes
* Building variants
* Asset metadata
* Transforms
* Camera bookmarks
* Annotations
* Viewer settings
* Share links
* Upload and processing status

It does **not** store GLB, PLY, SOG, SPZ, textures or thumbnails.

### S3: binary files

Use separate private buckets for development and production:

```text
gaussian-viewer-dev-assets
gaussian-viewer-prod-assets
```

Suggested key structure:

```text
projects/{projectId}/
├── assets/{assetId}/
│   ├── original/
│   │   └── uploaded-file.ply
│   ├── runtime/
│   │   └── scene.sog
│   └── metadata/
│       └── processing-report.json
│
├── previews/
│   ├── project-cover.webp
│   └── variant-{variantId}.webp
│
└── exports/
    └── optional-future-files
```

Files should use immutable asset IDs. Replacing a model creates a new asset rather than overwriting the old object.

The bucket remains private with S3 Block Public Access enabled. Browser uploads use temporary presigned URLs, so the API does not need to receive or relay multi-gigabyte files. ([AWS Documentation][2])

---

# Core project model

```text
User
└── owns many Projects

Project
├── one or more Scenes
├── project settings
├── cover image
├── share links
└── archived/deleted state

Scene
├── Gaussian environment asset
├── environment transform
├── ground/proxy settings
├── camera settings
├── Building Variants
├── Camera Bookmarks
└── Annotations
└── Lighting Settings
        └── Ambient light
        └── Sun Direction
        └── Color



Building Variant
├── GLB asset
├── name
├── transform
├── visibility
├── display order
└── optional material overrides
```

Example collections:

```text
users
projects
scenes
assets
variants
camera_bookmarks
annotations
share_links
upload_sessions
```

Every stored settings object should have a version:

```json
{
  "settingsVersion": 1,
  "activeVariantId": "...",
  "exposure": 1,
  "qualityPreset": "high",
  "showAnnotations": true
}
```

That gives us a controlled migration path when settings change without breaking old projects.

---

# User and sharing model

There are only two access modes initially.

## Authenticated owner

The owner can:

* Create and delete projects.
* Upload and replace files.
* Align the splat and building.
* Create variants.
* Save cameras and annotations.
* Create or revoke share links.

Firebase handles login, while the Express API verifies Firebase ID tokens and resolves the authenticated user. ([Firebase][3])

## Anonymous shared viewer

The viewer:

* Does not need an account.
* Opens `/share/{token}`.
* Receives a sanitized, read-only project manifest.
* Can only use presentation controls permitted by the owner.
* Cannot call any mutation endpoint.

Sharing flow:

```text
Owner clicks Share
        ↓
API generates a cryptographically random token
        ↓
Only the token hash is stored in MongoDB
        ↓
URL: /share/{token}
        ↓
Anonymous visitor requests public manifest
        ↓
API validates token, expiry and enabled state
        ↓
API returns project data plus temporary S3 download URLs
```

The S3 files themselves remain private. Possession of the share URL grants temporary viewing access, not direct permanent access to the bucket.

For ordinary GLB and single-file splats, short-lived S3 presigned GET URLs are sufficient. When we introduce splat formats that request many streamed chunks, CloudFront signed cookies are more practical than signing every individual object. CloudFront supports both signed URLs and signed cookies for private content. ([AWS Documentation][4])

---

# Repository structure

```text
gaussian-viewer/
├── apps/
│   ├── web/                 React application
│   ├── api/                 Express API
│   └── worker/              Processing worker
│
├── packages/
│   ├── contracts/           Shared Zod schemas and TypeScript types
│   ├── viewer-core/         Three.js/Spark viewer code
│   ├── database/            MongoDB models and repositories
│   ├── storage/             S3 abstraction
│   ├── auth/                Shared authentication helpers
│   └── config/              Environment validation
│
├── docs/
│   ├── architecture.md
│   ├── data-model.md
│   ├── asset-contract.md
│   ├── api-contract.md
│   ├── security-model.md
│   └── handoff.md
│
├── infra/
│   ├── aws/
│   └── nginx/
│
├── tests/
├── AGENTS.md
├── pnpm-workspace.yaml
└── package.json
```

The `worker` application can remain an empty placeholder until external asset preparation is working reliably.

---

# Implementation phases

GPT-5.3-Codex has a 400,000-token context window, but each phase below deliberately stays far below that: one subsystem, limited directories and explicit acceptance tests. ([OpenAI Developers][5])

## Phase 0 — Architecture contracts

**Goal:** Remove ambiguity before implementation.

### Status

Complete

### Steps

1. Create the repository structure. Complete.
2. Write the architecture and data-model documents. Complete.
3. Define supported upload formats. Complete:

   * Building: `.glb`
   * Environment initially: `.spz` or direct `.ply`.
4. Define coordinate conventions. Complete:

   * Metres
   * Y-up
   * Shared project origin
5. Define the canonical transform contract: position, quaternion and scale with project-origin rebasing. Complete.
6. Define the MVP runtime asset budgets and viewer acceptance limits. Complete.
7. Define the asset lifecycle states: `UPLOADED`, `VALIDATING`, `READY`, `FAILED`, `DELETED`. Complete.
8. Define environment-variable contracts. Complete.
9. Create `AGENTS.md` with project rules. Complete.

### Acceptance

* Architecture decisions exist in version-controlled documents. Complete.
* Each major entity has a documented schema. Complete.
* The runtime splat format, asset budgets, transform contract and lifecycle states are documented before implementation continues. Complete.
* No production functionality exists. Complete.

### Codex scope

Documentation, configuration and skeleton folders only.

---

## Phase 1 — Monorepo foundation

**Goal:** Get the web and API applications running together.

### Status

Complete

### Steps

1. Configure pnpm workspaces. Complete.
2. Create the Vite React frontend. Complete.
3. Create the Express API. Complete.
4. Add shared TypeScript configuration. Complete.
5. Add a shared contracts package for asset, manifest and scene schemas so web, API and worker code can rely on one source of truth. Complete.
6. Add ESLint, formatting and tests. Complete.
7. Add runtime environment validation for local development and future deployment secrets. Complete.
8. Add basic API health endpoint. Complete.
9. Configure local development commands. Complete.

### Acceptance

```text
pnpm install
pnpm dev
pnpm test
pnpm lint
```

All work from a clean clone is wired up and verified. Complete.
Shared contracts and configuration are available before the first asset or persistence workflow is implemented. Complete.

### Out of scope

Authentication, MongoDB, private S3, upload processing and the viewer runtime proof.

---

## Phase 2 — Local hybrid-viewer proof

**Goal:** Prove that a splat and GLB building can render together before building the application around them.

### Status

In progress. The reusable viewer implementation is complete; representative local assets are required for the proof and performance gate.

### Steps

1. Create `packages/viewer-core`. Complete.
2. Initialize the Three.js renderer, scene and camera. Complete.
3. Load one local Gaussian-splat test file using the selected runtime format and documented loader API. Pending representative `.spz` or `.ply` asset.
4. Load one local GLB building and apply the canonical transform contract. Pending representative `.glb` asset.
5. Add orbit controls and keep camera state separated from durable scene state. Complete.
6. Add resize and disposal handling. Complete.
7. Add loading, validation and error states. Complete.
8. Add simple visibility toggles. Complete.
9. Add basic environment transform controls: position, Euler rotation and uniform scale. Complete.
10. Prove mesh/splat occlusion and depth interaction with representative assets. Pending representative asset pair.
11. Measure repeated load/unload cycles for memory growth and resource disposal. Pending representative asset pair.
12. Document the exact runtime loader settings, renderer budgets and acceptable quality presets for the selected runtime format. Complete.

### Phase 2 completion gate

Phase 2 is not complete until all of the following are true:

* One representative splat and one representative GLB are loaded successfully in the browser.
* Mesh/splat depth interaction and occlusion behaviour are verified with that real asset pair.
* Desktop and mobile asset budgets are documented and checked against the representative files.
* The transform contract is confirmed and applied to both assets.
* Repeated load/dispose cycles do not show material memory growth or worker/resource leaks.
* The chosen runtime splat format and loader API are locked down for the MVP.

### Acceptance

* The viewer can load a splat and GLB once the local assets are provided. Implementation complete; browser verification pending.
* The GLB can be translated, rotated and scaled using the canonical transform contract. Complete.
* Reloading does not leak canvases or event handlers. Implementation complete; repeated browser-cycle measurement pending.
* Errors are presented rather than crashing the application. Complete.
* The Phase 2 completion gate above is satisfied with representative assets. Pending.

### Out of scope

Uploads, saving and users.

---

## Phase 3 — Authentication

**Goal:** Establish the authenticated owner experience.

**Status:** Complete.

### Steps

1. Configure Firebase Authentication. (Complete)
2. Add Google login. (Complete)
3. Optionally add email/password login. (Not implemented; optional.)
4. Add frontend authentication context. (Complete)
5. Send the Firebase ID token to the API. (Complete)
6. Verify tokens in Express middleware. (Complete)
7. Upsert a local MongoDB user record. (Complete)
8. Protect application routes. (Complete)
9. Add logout and expired-session handling. (Complete)

### Acceptance

* A user can log in and out.
* Protected API requests require a valid token.
* An unauthenticated visitor cannot open the project dashboard.
* The local user record uses Firebase UID as the external identity.

### Out of scope

Admin roles and team collaboration.

---

## Phase 4 — Projects and dashboard

**Goal:** Give users a persistent place to see all previous projects.

**Status:** In progress — implementation and automated checks complete; manual acceptance testing remains.

### Steps

1. Add `projects` and initial `scenes` collections. (Complete)
2. Implement project create, read, update, archive and delete endpoints. (Complete)
3. Enforce project ownership in the API. (Complete)
4. Build `/projects`. (Complete)
5. Display: (Complete)

   * Project name
   * Cover placeholder
   * Last modified date
   * Asset status
   * Share status
6. Build project creation dialog. (Complete)
7. Add project settings page. (Complete)
8. Add empty editor route. (Complete)

### Acceptance

* Users only see their own projects.
* Projects survive reload and logout.
* A user can create, rename, archive and reopen a project.
* Direct requests for another user’s project return an authorization error.

---

## Phase 5 — Asset records and private S3

**Goal:** Introduce private file storage without handling huge uploads yet.

**Status:** Implementation complete — AWS bucket deployment and manual browser-to-S3 acceptance remain.

### Steps

**Status update:** Existing-bucket configuration and manual browser-to-S3 acceptance remain; no dedicated bucket deployment is required.

1. Use the existing main-application S3 bucket. (A dedicated development bucket is optional.)
2. Retain the bucket's existing private-access policy and grant the API only the required `projects/*` object permissions.
3. Configure CORS for the application domain on that bucket.
4. Add the `assets` collection. (Complete)
5. Add asset states:

```text
CREATED
UPLOADING
UPLOADED
VALIDATING
READY
FAILED
DELETED
```

6. Create an API endpoint that issues a presigned PUT URL. (Complete)
7. Upload directly from the browser to S3. (Complete)
8. Add an upload-completion endpoint. (Complete)
9. Verify object existence, size and checksum or equivalent metadata. (Complete)
10. Validate the uploaded object before marking it `READY`; do not treat `UPLOADED` as sufficient readiness. (Complete)
11. Generate short-lived presigned GET URLs. (Complete)
12. Add file type, magic-byte and size validation. (Complete)
13. Generate S3 keys server-side and never accept an arbitrary client-supplied object key. (Complete)

### Initial limitation

Use this route for smaller GLB and test assets only.

### Storage scope decision

This office-only MVP uses the existing main-application S3 bucket. The API configuration supplies its region
and bucket name through `AWS_REGION` and `AWS_S3_BUCKET`. Asset keys remain server-generated and namespaced
under `projects/{projectId}/assets/{assetId}/`, so this feature cannot overwrite unrelated application objects.
The CloudFormation bucket template remains an optional fallback for a future isolated environment.

### Acceptance

* Uploaded objects never pass through Express.
* Objects cannot be opened through an unsigned public S3 URL.
* Assets belong to a project and owner.
* Deleting an asset record does not accidentally expose or overwrite another asset.

---

## Phase 6 — Multipart uploads for large splats

**Goal:** Reliably upload multi-gigabyte environments.

**Status:** Implementation complete — lifecycle configuration and live large-file acceptance remain.

AWS recommends considering multipart upload once objects reach approximately 100 MB because failed parts can be retried independently. ([AWS Documentation][6])

### Steps

1. Add `upload_sessions`. (Complete)
2. Create multipart initiation endpoint. (Complete)
3. Generate signed URLs for individual parts. (Complete)
4. Upload chunks directly from the browser. (Complete)
5. Record uploaded part numbers and ETags. (Complete)
6. Add progress reporting. (Complete)
7. Add retry for failed parts. (Complete)
8. Add resume after refresh. (Complete; reselect the same local file after refresh)
9. Complete the multipart upload. (Complete)
10. Add explicit abort. (Complete)
11. Configure an S3 lifecycle rule to clear abandoned multipart uploads after seven days. ([AWS Documentation][7]) (Configuration supplied; apply it to the existing bucket)

### Acceptance

* A large test file can upload with visible progress.
* Interrupting and resuming does not restart completed parts.
* Aborting clears the upload session.
* Failed parts can be retried individually.
* Incomplete uploads are eventually removed automatically.

---

## Phase 7 — Scene manifest and persistent editor state

**Goal:** Define the single payload that reconstructs a project.

**Status:** Implementation complete — scene reconstruction, settings migration, debounced optimistic persistence, revision conflicts and opening-camera restoration are covered by automated checks. Live acceptance against Firebase, MongoDB and the configured private S3 bucket remains.

### Steps

1. Create the scene-manifest schema. (Complete)
2. Add a protected manifest endpoint. (Complete)
3. Include:

   * Environment asset
   * Variants
   * Transforms
   * Viewer settings
   * Default camera
   * Annotations
4. Resolve S3 keys to temporary URLs only when returning the manifest. (Complete)
5. Add client-side project loading. (Complete)
6. Add debounced settings persistence. (Complete)
7. Add optimistic update handling. (Complete)
8. Add settings-version migration support. (Complete for initial schema version migration)
9. Add revision-based scene updates and reject stale writes with a `409 Conflict` when the client sends an outdated revision. (Complete)
10. Keep viewer-only state (for example camera pose or temporary UI state) separate from durable scene state. (Complete)
11. Add an explicit **Save opening camera** action that records the current camera position, orbit-controls target and field of view as the scene's `defaultCamera`. (Complete)
12. After a project manifest and its scene assets finish loading, restore `defaultCamera` before enabling normal presentation; use the runtime fallback camera only when no saved default exists. (Complete)
13. When saving the opening camera, capture the rendered canvas as a WebP, upload it through an owner-issued storage URL and use its verified project cover as the dashboard thumbnail. (Complete)

### Acceptance

* Opening a project reconstructs its current scene.
* S3 keys are stored in MongoDB; temporary URLs are not.
* Reloading preserves the camera and viewer settings.
* Saving the opening camera and reopening the project restores the exact position, target and field of view after assets load.
* Saving the opening camera also updates the project dashboard thumbnail without exposing a permanent storage URL.
* Invalid or outdated settings are migrated or rejected clearly.
* Concurrent edits and tab switches do not silently overwrite newer scene state.

---

## Phase 8 — Full scene editor

**Goal:** Let the owner align the environment and first building model.

**Status:** Implementation complete — live acceptance with representative private assets is still required.

### Steps

1. Load the environment from the project manifest.
2. Load the GLB building.
3. Add object selection. (Complete)
4. Add transform gizmos. (Switchable between move and rotate) (Complete)
5. Add numeric position, rotation and scale fields. (Complete)
6. Add environment transform controls. (Complete)
7. Add visibility controls. (Complete)
9. Add reset and undo for the current edit session. (Complete)
10. Save transforms to MongoDB. (Complete)
11. Add a basic proxy-ground object. (Complete)

### Acceptance

* The owner can align a building with the captured site. (Implementation complete; live acceptance pending.)
* Numeric and gizmo transforms remain synchronized. (Implemented.)
* Closing and reopening restores the exact alignment. (Implemented; live acceptance pending.)
* Viewer-only state is separated from persisted scene state. (Implemented.)

---

## Phase 9 — Multiple building variants -- SKIP THIS PHASE

**Goal:** Make design alternatives a first-class feature.

### Steps

1. Create the `variants` collection.-- SKIP
2. Add variant CRUD endpoints.-- SKIP
3. Attach one GLB asset to each variant.-- SKIP
4. Add variant upload and replacement.-- SKIP
5. Add rename, reorder and duplicate.-- SKIP
6. Store independent transforms for each variant.-- SKIP
7. Add active-variant selection.-- SKIP
8. Add optional multi-variant visibility for internal comparison.-- SKIP
9. Add variant-specific camera thumbnail.-- SKIP
10. Save the default public variant.-- SKIP

### Acceptance

* A project can contain multiple proposed buildings.
* Switching variants does not reload the Gaussian environment.
* Each variant retains its own transform.
* Removing one variant does not delete assets referenced elsewhere.
* The selected default variant survives reload.

At this point, the application is a usable **private internal MVP**.

---

## Phase 10 — Anonymous read-only sharing

**Goal:** Share a project without requiring the investor to register.

**Status:** Complete.

### Steps

1. Create the `share_links` collection.
2. Generate a high-entropy random token.
3. Store only its hash.
4. Add:

   * Enable/disable
   * Optional expiry
   * Revoke
   * Regenerate
5. Redact share tokens from logs, telemetry and error reports.
6. Create the public endpoint:

```text
GET /api/public/shares/{token}/manifest
```

6. Return only sanitized presentation data.
7. Issue temporary asset URLs after token validation.
8. Build `/share/{token}`.
9. Remove all editor controls.
10. Add `noindex` and a restrictive referrer policy.
11. Ensure mutation endpoints never accept share-token authentication.

### Shared sky controls (completed addition)

The fixed scene sky sphere has durable visibility and Y-axis rotation settings. Both the owner and
anonymous shared viewer apply the same settings. Viewer settings version 1 records migrate to
version 2 with the sky visible and unrotated.

### Share permissions

```json
{
  "allowVariantSwitching": true,
  "showAnnotations": true,
  "showProjectDescription": true,
  "showTechnicalInformation": false
}
```

### Acceptance

* The link works in an incognito browser without login. (Complete.)
* Disabling or revoking the link stops access, or the system explicitly documents the bounded expiry window for already-issued asset URLs. (Implemented: future manifests stop immediately; previously issued S3 URLs last at most five minutes.)
* An expired link stops access. (Implemented.)
* Anonymous viewers cannot change any project state. (Implemented.)
* Private owner information is absent from the public manifest. (Implemented.)
* Share tokens are never emitted into logs or analytics. (Implemented.)

This completes the **shareable MVP**.

---

## Phase 10.5 — Editor UI Upgrade

**Goal:**  Compact the ui into a more orderd structure

**Status:** Implementation complete; manual acceptance pending.

1. Add tabs to the inspector panel (the left side of the editor canvas)
        a. Assets
                -Upload Environment (if one exists, replace it when uploadin a new one)
                -Remove Asset
                -Upload Building (if one exists, replace it when uploadin a new one)
                -Remove Asset
        b. layouts
                -Object Selector
                -The transform controls
        c. Lighting
                -Power control for the sun
                -Color controls for the sun
                -Rotation controls for the main sun light
                -Power control for the Ambient ligth
                -Color control for the Ambient light
        d. Annotations
                -Object Selector (same as b.)
                -Add annotation
                -Title
                -Description
                -Color
                -Delete (removes selected annotation if one is selected)

### Acceptance

        * User will verify manually

### Implementation notes

The owner editor's inspector now has Assets, Layouts, Lighting and Annotations tabs. Asset
uploads and the use/remove actions are grouped under Assets; replacing an environment or building
continues to use the existing revision-checked scene update flow. Layouts contains the existing
canonical transform controls and local display/edit-session controls. Lighting contains durable
sky Y-axis rotation plus sun and ambient power, color and rotation settings, all persisted through
the existing revision-checked scene update flow.

Opening the Lighting tab attaches the rotate gizmo to a center-origin phantom light handle. The
directional sun follows that handle's rotation, and the previous selected scene object and gizmo
mode are restored on leaving the tab.

The Annotations tab provides the requested draft fields while annotation markers and durable scene
state remain Phase 11 work.

---

## Phase 11 — Annotations

**Goal:** Turn the viewer into a controlled presentation.

**Status:** Complete — durable, revision-checked annotations, private/public presentation filtering and
named investor comments are implemented. Live browser acceptance remains for real project assets.

### Steps

1. Add annotation points. (Complete: labelled 3D circles open a title/description overlay.)
2. Add a comment box to the additional information box where the investor can post a comment to the annotation. (Complete.)
2.2 Add a name field, remembered in a browser cookie, and show an annotation's prior comments when it is opened. (Complete.)
2.1 Add a little icon to the project card notifing the creator that there is a new investor comment. (Complete.)
2.3 Show investor comments below the editor canvas, with explicit acknowledge and delete controls. (Complete.)
5. Annotation flow: (Complete.)
        a. Button "Add Annotation" (adds a new annotation to the scene at 0,0,0)
        b. Adds the annotation to the drop down with object to transform and selects it
        c. Locations of all annotation are stored in the project
5. Add annotation titles and descriptions. (Complete.)
6. Add annotation visibility rules. (Complete: private annotations never enter a public manifest.)


### Acceptance

* Annotations remain correctly positioned after reload.
* Internal annotations can be excluded from sharing.


---

## Phase 12 — Investor-viewer polish

**Goal:** Produce a presentation-ready public experience.

### Steps

1. Add fullscreen mode.
2. Add responsive desktop, tablet and phone layouts.
3. Add quality presets.
4. Add loading percentage and meaningful progress.
5. Add variant comparison controls. -SKIP
6. Add before/proposed visibility toggle.  -SKIP
7. Add project branding.  -SKIP
8. Add project cover image. -USE THUMBNAIL
9. Add unsupported-browser messaging.
10. Add a loading throbber while downloading assets
10. Add graceful handling for slow connections.
11. Add keyboard and touch navigation. (Completed)

### Acceptance

* A non-technical viewer can open and navigate the project.
* The initial camera and default variant are immediately understandable.
* Mobile devices receive a lower safe quality preset.
* Loading failures provide recovery actions.

This completes the **investor beta**.

---

## Phase 13 — Optional processing worker

**Goal:** Automate preparation while retaining support for externally prepared assets.

### First worker capabilities

1. Validate uploaded GLB files.
2. Extract dimensions and triangle counts.
3. Generate thumbnails.
4. Detect unexpectedly large textures.
5. Produce an asset report.
6. Move assets through processing states.
7. Report processing failure clearly.

### Later worker capabilities

* GLB optimization.
* Texture conversion to KTX2.
* Splat conversion.
* Splat cleanup assistance.
* Automated LOD generation.
* Preview video generation.

### Important boundary

The first release should continue accepting already prepared:

```text
.glb
.sog / .spz / .ply / selected runtime splat format
```

The app should not depend on server-side splat reconstruction. The worker remains optional for validation, thumbnail generation and future conversion. The private MVP may load raw PLY directly in the browser, but does not claim to convert it to a compressed runtime asset.

---

## Phase 14 — CloudFront and production delivery

**Goal:** Efficiently deliver large private assets.

### Steps

1. Put CloudFront in front of the private S3 bucket.
2. Prevent direct public S3 access.
3. Configure the assets domain:

```text
assets.example.com
```

4. Continue using signed URLs for single-file assets.
5. Add signed cookies when streamed formats request many related files.
6. Configure cache headers for immutable asset IDs.
7. Deploy the React build.
8. Deploy the API behind HTTPS.
9. Configure production CORS.
10. Separate development and production credentials.
11. Add upload and download limits.

### Suggested deployment

```text
app.example.com       React frontend
api.example.com       Express API
assets.example.com    CloudFront → private S3
MongoDB Atlas         Project database
Firebase              Authentication
```

Your existing EC2 and Nginx setup is suitable for the initial API deployment. The frontend can initially be served by Nginx as well, while large assets remain in S3.

---

## Phase 15 — Security, reliability and beta testing

**Goal:** Protect project data and make failures recoverable.

### Steps

1. Add ownership tests for every private endpoint.
2. Add anonymous-share security tests.
3. Add rate limiting to public endpoints.
4. Add upload quotas.
5. Add allowed file extensions and MIME validation.
6. Add checksums for completed uploads.
7. Add soft deletion.
8. Add delayed S3 cleanup.
9. Add audit records for sharing and deletion.
10. Add structured API logs.
11. Add frontend error reporting.
12. Add browser-level Playwright tests.
13. Test large files, slow networks and revoked links.
14. Document backup and recovery procedures.

### Acceptance

* No project can be accessed by another authenticated owner.
* A share link gives read-only access to exactly one project.
* Failed uploads and processing jobs can be retried.
* Deleting database records does not leave uncontrolled public assets.
* Old projects continue loading after settings migrations.

---

# Codex phase-size rules

Each phase should be issued as one to three separate Codex tasks.

Use this hard envelope:

```text
One task:
- One clear subsystem
- Usually 5–15 production files
- Hard ceiling around 20 files
- Ideally under 2,500 changed lines
- Includes its own tests
- No unrelated refactoring
```

Each Codex task should receive:

```text
1. Goal
2. Documents to read
3. Exact directories in scope
4. Required API or schema
5. Explicit exclusions
6. Acceptance tests
7. Commands that must pass
8. Required documentation update
```

At the end of every phase, update:

```text
docs/handoff.md
```

It should contain:

* What was implemented.
* Important decisions.
* Database migrations.
* New environment variables.
* Known limitations.
* Commands that pass.
* Exact starting point for the next phase.

This prevents later Codex sessions from depending on a long chat history or reconstructing architectural decisions from the entire repository.

## Milestone boundaries

```text
Phases 0–2    Technical foundation
Phases 3–8    Private internal MVP
Phases 9–10   Shareable MVP
Phases 11–12  Investor beta
Phases 13–15  Production system
```

The correct first implementation package is **Phase 0 only**: repository contract, data model, asset contract, security model and `AGENTS.md`.

[1]: https://sparkjs.dev/?utm_source=chatgpt.com "Spark: Home"
[2]: https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html?utm_source=chatgpt.com "Download and upload objects with presigned URLs"
[3]: https://firebase.google.com/docs/auth/admin/verify-id-tokens?utm_source=chatgpt.com "Verify ID Tokens | Firebase Authentication - Google"
[4]: https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-signed-urls.html?utm_source=chatgpt.com "Use signed URLs - Amazon CloudFront"
[5]: https://developers.openai.com/api/docs/models/gpt-5.3-codex?utm_source=chatgpt.com "GPT-5.3-Codex Model | OpenAI API"
[6]: https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpuoverview.html?utm_source=chatgpt.com "Uploading and copying objects using multipart upload in ..."
[7]: https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpu-abort-incomplete-mpu-lifecycle-config.html?utm_source=chatgpt.com "Configuring a bucket lifecycle configuration to delete ..."
