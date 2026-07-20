# Asset contract

## Supported formats

| Asset                | MVP input      | MVP runtime    |
| -------------------- | -------------- | -------------- |
| Building             | `.glb`         | `.glb`         |
| Gaussian environment | `.spz`, `.ply` | `.spz`, `.ply` |

Spark loads `.spz` and `.ply` directly in the local viewer. `.spz` remains the preferred compressed delivery format, but direct PLY is permitted for the private MVP. The API recognizes both the `NGSP` header used by SPZ v4 and the gzip (`1F 8B`) signature used by valid legacy SPZ v1–v3 files. Browser-side PLY-to-SPZ compression is not part of the runtime; an external conversion workflow may be added later if file transfer or startup time requires it.

## Coordinates and transforms

- Units are metres.
- The coordinate system is right-handed and Y-up.
- Every scene has a shared project origin. Imported source coordinates are rebased to it before their canonical transforms are persisted.
- A transform is position, quaternion and non-zero scale as specified in `data-model.md`. Euler rotations are UI input only and must be converted to a quaternion before persistence.
- No loader may introduce a hidden axis conversion, scale factor or origin offset. Any import conversion must be explicit and recorded in asset metadata.

## Lifecycle

`UPLOADED` → `VALIDATING` → `READY`

Validation failure transitions to `FAILED`. An asset can transition to `DELETED` from any non-deleted state. `READY` is the only state allowed in a scene manifest. Deletion is soft initially; storage cleanup is delayed and must never reuse the deleted asset key.

## MVP runtime budgets

| Target  | Environment download | Splat count | GLB download | Triangles | Decoded texture memory |
| ------- | -------------------: | ----------: | -----------: | --------: | ---------------------: |
| Desktop |               750 MB |   8 million |       100 MB | 2 million |                 512 MB |
| Mobile  |               150 MB | 1.5 million |        25 MB |   500,000 |                 128 MB |

These are recommended runtime budgets, not upload limits. The local viewer warns when a selected environment or building exceeds its active profile budget but permits loading. Phase 2 must measure representative assets against them and select a lower quality preset or document the accepted private-MVP risk.

## Storage keys

Keys are generated server-side and immutable:

```text
projects/{projectId}/assets/{assetId}/original/{filename}
projects/{projectId}/assets/{assetId}/runtime/scene.spz
projects/{projectId}/assets/{assetId}/metadata/processing-report.json
projects/{projectId}/cover/project-cover.webp
```

The client never provides an arbitrary object key. A replacement asset creates a new asset ID. The
project-cover key is the controlled exception: the API alone issues a signed overwrite URL after an owner
saves the opening camera, and MongoDB stores that key only after the uploaded WebP has passed size,
checksum and signature validation.
