# Viewer runtime contract

## Locked loader path

The MVP viewer uses `three@0.185.1` and `@sparkjsdev/spark@2.1.0`. The npm package exports `SparkRenderer` and `SplatMesh`; the viewer uses those exact APIs rather than the unreleased documentation naming for a newer renderer class.

The environment loader accepts `.spz` and `.ply` files and constructs the mesh with:

```ts
new SplatMesh({ fileBytes, fileName, lod: true });
```

The Three.js `GLTFLoader` parses a local `.glb` directly from its `ArrayBuffer`. Both assets receive the canonical position/quaternion/scale transform before being attached to the scene. Spark `SplatMesh` supports only uniform object scale in this mode, so the environment transform rejects non-uniform scale explicitly.

## Renderer settings

`SparkRenderer` is added to the normal Three.js scene hierarchy. It is configured with `enableLod: true`, `depthTest: true`, `depthWrite: false`, and the profile-specific settings below. Normal Three.js rendering drives both the mesh and splat renderer.

| Profile | Download environment | Download GLB | LOD splats | Maximum standard deviation | Pixel-ratio limit |
| ------- | -------------------: | -----------: | ---------: | -------------------------: | ----------------: |
| Desktop |              750 MiB |      100 MiB |  2,500,000 |                         √8 |                 2 |
| Mobile  |              150 MiB |       25 MiB |  1,500,000 |                         √5 |                 1 |

Files above the active profile budget show a warning but remain selectable. The browser chooses the mobile profile below 768px viewport width. The profile is a safe starting point, not proof that a particular GPU/device can load every permitted asset.

## Lifecycle and error behaviour

`HybridViewer` owns one supplied canvas, an animation loop, `ResizeObserver`, orbit controls, Spark renderer and loaded assets. Replacing a splat or building disposes its current GPU-side resources before adding the replacement. Disposing the viewer stops the animation loop, disconnects the observer, disposes controls, assets, Spark and the WebGL renderer.

Loading emits `loading-environment`, `loading-building`, `ready` or `error` state. The web UI presents that state and validates `.spz`/`.ply`/`.glb` selection, shows profile-size warnings and exposes environment position, uniform scale and Euler XYZ degrees. Each alignment slider is a spring-returning rate control: hold it away from centre to nudge continuously, with distance from centre controlling the rate and the slow/fast selector setting the maximum rate. A separate numeric field sets an exact value. In the owner editor, the selected environment or building may also be moved or rotated with Three.js transform controls; gizmo changes are read back as canonical position/quaternion/scale transforms and share the same revision-checked save queue as numeric changes. The browser converts Euler values to the canonical persisted quaternion transform; the building remains at its authored metre scale. The display-only building opacity/wireframe, proxy ground, selected object, gizmo mode and undo history remain local to the edit session. PLY files have no single reliable world-axis convention, so no automatic flip is applied—use the environment Euler controls to correct a given file. Camera movement and UI state remain local to the viewer; no state is persisted.

## Verification still required

No representative environment or building asset is in this repository. Before Phase 2 can close, load a representative `.spz` or `.ply` and `.glb`, verify occlusion/depth behaviour and alignment, measure actual desktop/mobile load and memory behaviour, and exercise repeated replacement/disposal cycles in browser developer tools.
