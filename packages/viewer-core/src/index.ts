import type { DefaultCamera, SceneAnnotation, Transform } from '@gaussian-viewer/contracts';
import { SparkRenderer, SplatMesh } from '@sparkjsdev/spark';
import {
  AmbientLight,
  BackSide,
  Color,
  CircleGeometry,
  DirectionalLight,
  Euler,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  PerspectiveCamera,
  Quaternion,
  Scene,
  ShaderMaterial,
  SRGBColorSpace,
  SphereGeometry,
  Texture,
  TextureLoader,
  WebGLRenderer,
  Raycaster,
  Vector2,
  Vector3,
  type Material,
  type Object3D,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls as ThreeTransformControls } from 'three/addons/controls/TransformControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export type { Transform } from '@gaussian-viewer/contracts';

export const DEFAULT_TRANSFORM: Transform = {
  position: [0, 0, 0],
  quaternion: [0, 0, 0, 1],
  scale: [1, 1, 1],
};

export type ViewerStatus = 'idle' | 'loading-environment' | 'loading-building' | 'ready' | 'error';
export type AssetKind = 'environment' | 'building';
export type TransformGizmoMode = 'translate' | 'rotate';

export interface AnnotationScreenPosition {
  id: string;
  x: number;
  y: number;
  visible: boolean;
}

export interface ViewerState {
  status: ViewerStatus;
  message?: string;
  warning?: string;
}

export interface ViewerQualityProfile {
  environmentWarningBytes: number;
  buildingWarningBytes: number;
  lodSplatCount: number;
  maxStdDev: number;
  pixelRatioLimit: number;
}

const MEBIBYTE = 1024 * 1024;

export const DESKTOP_QUALITY_PROFILE: ViewerQualityProfile = {
  environmentWarningBytes: 750 * MEBIBYTE,
  buildingWarningBytes: 100 * MEBIBYTE,
  lodSplatCount: 2_500_000,
  maxStdDev: Math.sqrt(8),
  pixelRatioLimit: 2,
};

export const MOBILE_QUALITY_PROFILE: ViewerQualityProfile = {
  environmentWarningBytes: 150 * MEBIBYTE,
  buildingWarningBytes: 25 * MEBIBYTE,
  lodSplatCount: 1_500_000,
  maxStdDev: Math.sqrt(5),
  pixelRatioLimit: 1,
};

export interface HybridViewerOptions {
  mobile?: boolean;
  onStateChange?: (state: ViewerState) => void;
  onTransformStart?: (kind: AssetKind, transform: Transform) => void;
  onTransformChange?: (kind: AssetKind, transform: Transform) => void;
  onSunRotationChange?: (rotationDegrees: [number, number, number]) => void;
  onAnnotationClick?: (annotationId: string) => void;
  onAnnotationTransformStart?: (
    annotationId: string,
    position: SceneAnnotation['position'],
  ) => void;
  onAnnotationTransformChange?: (
    annotationId: string,
    position: SceneAnnotation['position'],
  ) => void;
}

export function applyTransform(object: Object3D, transform: Transform): void {
  object.position.fromArray(transform.position);
  object.quaternion.fromArray(transform.quaternion).normalize();
  object.scale.fromArray(transform.scale);
  object.updateMatrixWorld(true);
}

export function transformFromObject(object: Object3D): Transform {
  object.updateMatrixWorld(true);
  return {
    position: object.position.toArray() as Transform['position'],
    quaternion: object.quaternion.normalize().toArray() as Transform['quaternion'],
    scale: object.scale.toArray() as Transform['scale'],
  };
}

export function createTransformFromEulerDegrees(
  position: Transform['position'],
  rotationDegrees: [number, number, number],
  uniformScale: number,
): Transform {
  const x = (rotationDegrees[0] * Math.PI) / 180;
  const y = (rotationDegrees[1] * Math.PI) / 180;
  const z = (rotationDegrees[2] * Math.PI) / 180;
  const quaternion = new Quaternion().setFromEuler(new Euler(x, y, z, 'XYZ'));

  return {
    position,
    quaternion: quaternion.toArray() as Transform['quaternion'],
    scale: [uniformScale, uniformScale, uniformScale],
  };
}

export function setTransformEulerDegrees(
  transform: Transform,
  rotationDegrees: [number, number, number],
): Transform {
  const quaternion = new Quaternion().setFromEuler(
    new Euler(
      (rotationDegrees[0] * Math.PI) / 180,
      (rotationDegrees[1] * Math.PI) / 180,
      (rotationDegrees[2] * Math.PI) / 180,
      'XYZ',
    ),
  );
  return { ...transform, quaternion: quaternion.toArray() as Transform['quaternion'] };
}

export function getTransformEulerDegrees(transform: Transform): [number, number, number] {
  const euler = new Euler().setFromQuaternion(
    new Quaternion().fromArray(transform.quaternion),
    'XYZ',
  );
  return [(euler.x * 180) / Math.PI, (euler.y * 180) / Math.PI, (euler.z * 180) / Math.PI];
}

export function validateRuntimeFile(file: Pick<File, 'name' | 'size'>, kind: AssetKind): void {
  const extensions = kind === 'environment' ? ['.ply', '.spz'] : ['.glb'];

  if (!extensions.some((extension) => file.name.toLowerCase().endsWith(extension))) {
    throw new Error(
      `${kind === 'environment' ? 'Environment' : 'Building'} must be a ${extensions.join(' or ')} file.`,
    );
  }
}

export function getRuntimeFileWarning(
  file: Pick<File, 'name' | 'size'>,
  kind: AssetKind,
  profile: ViewerQualityProfile,
): string | undefined {
  const warningBytes =
    kind === 'environment' ? profile.environmentWarningBytes : profile.buildingWarningBytes;

  if (file.size > warningBytes) {
    return `${file.name} exceeds the recommended ${Math.floor(warningBytes / MEBIBYTE)} MiB ${kind} budget; loading may be slow or run out of memory.`;
  }

  return undefined;
}

export class HybridViewer {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(55, 1, 0.01, 10_000);
  readonly renderer: WebGLRenderer;
  readonly controls: OrbitControls;
  readonly qualityProfile: ViewerQualityProfile;

  private readonly canvas: HTMLCanvasElement;
  private readonly observer: ResizeObserver;
  private readonly spark: SparkRenderer;
  private readonly transformControls: ThreeTransformControls;
  private readonly transformControlsHelper: Object3D;
  private readonly backgroundColor = new Color('#10151c');
  private readonly onStateChange?: (state: ViewerState) => void;
  private readonly onTransformStart?: HybridViewerOptions['onTransformStart'];
  private readonly onTransformChange?: HybridViewerOptions['onTransformChange'];
  private readonly onSunRotationChange?: HybridViewerOptions['onSunRotationChange'];
  private readonly onAnnotationClick?: HybridViewerOptions['onAnnotationClick'];
  private readonly onAnnotationTransformStart?: HybridViewerOptions['onAnnotationTransformStart'];
  private readonly onAnnotationTransformChange?: HybridViewerOptions['onAnnotationTransformChange'];
  private splat?: SplatMesh;
  private building?: Object3D;
  private proxyGround?: Mesh;
  private readonly ambientLight: AmbientLight;
  private readonly sunLight: DirectionalLight;
  private readonly sunRotationHandle = new Group();
  private readonly testSphere: Mesh<SphereGeometry, MeshBasicMaterial>;
  private readonly annotationRoot = new Group();
  private readonly annotationMarkers = new Map<string, Group>();
  private readonly raycaster = new Raycaster();
  private readonly pointer = new Vector2();
  private readonly annotationWorldPosition = new Vector3();
  private readonly annotationViewPosition = new Vector3();
  private readonly annotationNdcPosition = new Vector3();
  private selectedAnnotationId?: string;
  private selectedKind?: AssetKind;
  private transformGizmoVisible = true;
  private disposed = false;

  constructor(canvas: HTMLCanvasElement, options: HybridViewerOptions = {}) {
    this.canvas = canvas;
    this.qualityProfile = options.mobile ? MOBILE_QUALITY_PROFILE : DESKTOP_QUALITY_PROFILE;
    this.onStateChange = options.onStateChange;
    this.onTransformStart = options.onTransformStart;
    this.onTransformChange = options.onTransformChange;
    this.onSunRotationChange = options.onSunRotationChange;
    this.onAnnotationClick = options.onAnnotationClick;
    this.onAnnotationTransformStart = options.onAnnotationTransformStart;
    this.onAnnotationTransformChange = options.onAnnotationTransformChange;

    this.renderer = new WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, this.qualityProfile.pixelRatioLimit));

    this.scene.background = this.backgroundColor;
    this.camera.position.set(6, 4, 6);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(0, 1, 0);
    this.controls.enableDamping = true;

    this.transformControls = new ThreeTransformControls(this.camera, canvas);
    this.transformControlsHelper = this.transformControls.getHelper();
    this.transformControls.setMode('translate');
    this.transformControls.addEventListener('dragging-changed', (event) => {
      this.controls.enabled = !event.value;
    });
    this.transformControls.addEventListener('mouseDown', () => {
      const object = this.transformControls.object;
      if (object && this.selectedKind) {
        this.onTransformStart?.(this.selectedKind, transformFromObject(object));
      } else if (object && this.selectedAnnotationId) {
        this.onAnnotationTransformStart?.(
          this.selectedAnnotationId,
          object.position.toArray() as SceneAnnotation['position'],
        );
      }
    });
    this.transformControls.addEventListener('objectChange', () => {
      const object = this.transformControls.object;
      if (object === this.sunRotationHandle) {
        this.applySunRotationFromHandle(true);
        return;
      }
      if (object && this.selectedKind) {
        this.onTransformChange?.(this.selectedKind, transformFromObject(object));
      } else if (object && this.selectedAnnotationId) {
        this.onAnnotationTransformChange?.(
          this.selectedAnnotationId,
          object.position.toArray() as SceneAnnotation['position'],
        );
      }
    });
    this.scene.add(this.transformControlsHelper);
    this.annotationRoot.name = 'Annotations';
    this.annotationRoot.renderOrder = 10_000;
    this.scene.add(this.annotationRoot);
    canvas.addEventListener('click', this.handleAnnotationClick);

    this.ambientLight = new AmbientLight(0xffffff, 1.8);
    this.scene.add(this.ambientLight);
    this.sunLight = new DirectionalLight(0xffffff, 2.5);
    this.sunLight.position.set(8, 12, 5);
    this.scene.add(this.sunLight);
    this.sunRotationHandle.name = 'Sun rotation handle';
    this.scene.add(this.sunRotationHandle);

    //Sky ================================================================================================
    const texture = new TextureLoader().load('/sky.jpg');

    this.testSphere = new Mesh(
      new SphereGeometry(1000, 32, 16),
      new MeshBasicMaterial({ map: texture, side: BackSide }),
    );
    this.testSphere.name = 'Test sphere';
    this.scene.add(this.testSphere);

    //End Sky  ===========================================================================================

    this.spark = new SparkRenderer({
      renderer: this.renderer,
      enableLod: true,
      lodSplatCount: this.qualityProfile.lodSplatCount,
      maxStdDev: this.qualityProfile.maxStdDev,
      depthTest: true,
      depthWrite: false,
    });
    this.scene.add(this.spark);

    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(canvas);
    this.resize();
    this.renderer.setAnimationLoop(() => {
      this.controls.update();
      this.update();
      this.renderer.render(this.scene, this.camera);
    });
  }

  async loadEnvironment(file: File, transform = DEFAULT_TRANSFORM): Promise<void> {
    this.assertActive();
    validateRuntimeFile(file, 'environment');

    if (!hasUniformScale(transform)) {
      throw new Error('Spark environments require uniform scale.');
    }

    const warning = getRuntimeFileWarning(file, 'environment', this.qualityProfile);
    this.setState({ status: 'loading-environment', message: `Loading ${file.name}`, warning });
    this.removeSplat();

    const mesh = new SplatMesh({
      fileBytes: await file.arrayBuffer(),
      fileName: file.name,
      lod: true,
    });
    applyTransform(mesh, transform);
    this.splat = mesh;
    this.scene.add(mesh);
    this.syncSelectedObject();

    try {
      await mesh.initialized;
      this.setState({ status: 'ready', message: `${file.name} loaded`, warning });
    } catch (error) {
      this.removeSplat();
      this.reportLoadFailure(error);
    }
  }

  async loadBuilding(file: File, transform = DEFAULT_TRANSFORM): Promise<void> {
    this.assertActive();
    validateRuntimeFile(file, 'building');
    const warning = getRuntimeFileWarning(file, 'building', this.qualityProfile);
    this.setState({ status: 'loading-building', message: `Loading ${file.name}`, warning });
    this.removeBuilding();

    try {
      const gltf = await new GLTFLoader().parseAsync(await file.arrayBuffer(), '');
      applyTransform(gltf.scene, transform);
      this.building = gltf.scene;
      this.scene.add(gltf.scene);
      this.syncSelectedObject();
      this.setState({ status: 'ready', message: `${file.name} loaded`, warning });
    } catch (error) {
      this.removeBuilding();
      this.reportLoadFailure(error);
    }
  }

  setBuildingTransform(transform: Transform): void {
    this.assertActive();
    if (this.building) {
      applyTransform(this.building, transform);
    }
  }

  setEnvironmentTransform(transform: Transform): void {
    this.assertActive();
    if (!hasUniformScale(transform)) {
      throw new Error('Spark environments require uniform scale.');
    }

    if (this.splat) {
      applyTransform(this.splat, transform);
    }
  }

  setVisible(kind: AssetKind, visible: boolean): void {
    this.assertActive();
    const item = kind === 'environment' ? this.splat : this.building;
    if (item) {
      item.visible = visible;
    }
  }

  setSkyVisible(visible: boolean): void {
    this.assertActive();
    this.testSphere.visible = visible;
  }

  setSkyRotation(rotationYDegrees: number): void {
    this.assertActive();
    this.testSphere.rotation.y = (rotationYDegrees * Math.PI) / 180;
  }

  setSunPower(power: number): void {
    this.assertActive();
    this.sunLight.intensity = Math.max(0, power);
  }

  setSunColor(color: string): void {
    this.assertActive();
    this.sunLight.color.set(color);
  }

  setSunRotation(rotationDegrees: [number, number, number]): void {
    this.assertActive();
    const x = (rotationDegrees[0] * Math.PI) / 180;
    const y = (rotationDegrees[1] * Math.PI) / 180;
    const z = (rotationDegrees[2] * Math.PI) / 180;
    this.sunRotationHandle.rotation.set(x, y, z, 'XYZ');
    this.applySunRotationFromHandle();
  }

  beginSunRotationEdit(rotationDegrees: [number, number, number]): void {
    this.assertActive();
    this.setSunRotation(rotationDegrees);
    this.selectedKind = undefined;
    this.transformControls.setMode('rotate');
    this.transformControls.attach(this.sunRotationHandle);
  }

  endSunRotationEdit(): void {
    this.assertActive();
    this.transformControls.detach();
  }

  setAmbientPower(power: number): void {
    this.assertActive();
    this.ambientLight.intensity = Math.max(0, power);
  }

  setAmbientColor(color: string): void {
    this.assertActive();
    this.ambientLight.color.set(color);
  }

  selectAsset(kind: AssetKind | undefined): void {
    this.assertActive();
    this.selectedKind = kind;
    this.selectedAnnotationId = undefined;
    this.syncSelectedObject();
  }

  setTransformGizmoMode(mode: TransformGizmoMode): void {
    this.assertActive();
    this.transformControls.setMode(mode);
  }

  setTransformGizmoVisible(visible: boolean): void {
    this.assertActive();
    this.transformGizmoVisible = visible;
    this.syncSelectedObject();
  }

  setAnnotations(annotations: SceneAnnotation[], scale = 10): void {
    this.assertActive();
    this.clearAnnotations();
    for (const annotation of annotations) {
      const marker = createAnnotationMarker(annotation, scale);
      this.annotationMarkers.set(annotation.id, marker);
      this.annotationRoot.add(marker);
    }
    this.syncSelectedObject();
  }

  setAnnotationPosition(annotationId: string, position: SceneAnnotation['position']): void {
    this.assertActive();
    this.annotationMarkers.get(annotationId)?.position.fromArray(position);
  }

  setAnnotationScale(scale: number): void {
    this.assertActive();
    this.annotationMarkers.forEach((marker) => marker.scale.setScalar(scale));
  }

  setAnnotationsVisible(visible: boolean): void {
    this.assertActive();
    this.annotationRoot.visible = visible;
  }

  selectAnnotation(annotationId: string | undefined): void {
    this.assertActive();
    this.selectedAnnotationId = annotationId;
    this.selectedKind = undefined;
    this.syncSelectedObject();
  }

  getAnnotationScreenPositions(): AnnotationScreenPosition[] {
    this.assertActive();
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    if (width < 1 || height < 1) return [];
    return [...this.annotationMarkers.entries()].map(([id, marker]) => {
      marker.getWorldPosition(this.annotationWorldPosition);
      this.annotationViewPosition
        .copy(this.annotationWorldPosition)
        .applyMatrix4(this.camera.matrixWorldInverse);
      this.annotationNdcPosition.copy(this.annotationWorldPosition).project(this.camera);
      return {
        id,
        x: (this.annotationNdcPosition.x * 0.5 + 0.5) * width,
        y: (-this.annotationNdcPosition.y * 0.5 + 0.5) * height,
        visible:
          this.annotationViewPosition.z < 0 &&
          Math.abs(this.annotationNdcPosition.x) <= 1 &&
          Math.abs(this.annotationNdcPosition.y) <= 1 &&
          this.annotationNdcPosition.z >= -1 &&
          this.annotationNdcPosition.z <= 1,
      };
    });
  }

  setBuildingOpacity(opacity: number): void {
    this.assertActive();
    const clampedOpacity = Math.min(1, Math.max(0, opacity));
    this.forEachBuildingMaterial((material) => {
      material.opacity = clampedOpacity;
      material.transparent = clampedOpacity < 1;
      material.needsUpdate = true;
    });
  }

  setBuildingWireframe(wireframe: boolean): void {
    this.assertActive();
    this.forEachBuildingMaterial((material) => {
      if ('wireframe' in material) {
        (material as Material & { wireframe: boolean }).wireframe = wireframe;
        material.needsUpdate = true;
      }
    });
  }

  setProxyGroundVisible(visible: boolean): void {
    this.assertActive();
    if (!this.proxyGround) {
      const ground = new Mesh(
        new PlaneGeometry(200, 200),
        new MeshStandardMaterial({ color: '#657482', roughness: 1, metalness: 0 }),
      );
      ground.name = 'Proxy ground';
      ground.rotation.x = -Math.PI / 2;
      this.proxyGround = ground;
      this.scene.add(ground);
    }
    this.proxyGround.visible = visible;
  }

  clearAsset(kind: AssetKind): void {
    this.assertActive();
    if (kind === 'environment') {
      this.removeSplat();
      return;
    }
    this.removeBuilding();
  }

  getCamera(): DefaultCamera {
    return {
      position: this.camera.position.toArray() as DefaultCamera['position'],
      target: this.controls.target.toArray() as DefaultCamera['target'],
      fov: this.camera.fov,
    };
  }

  setCamera(camera: DefaultCamera): void {
    this.camera.position.fromArray(camera.position);
    this.camera.fov = camera.fov;
    this.camera.updateProjectionMatrix();
    this.controls.target.fromArray(camera.target);
    this.controls.update();
  }

  captureScreenshot(): Promise<Blob> {
    this.assertActive();
    this.update();
    this.renderer.render(this.scene, this.camera);
    return new Promise((resolve, reject) => {
      this.canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error('The current canvas view could not be captured.'));
            return;
          }
          resolve(blob);
        },
        'image/webp',
        0.82,
      );
    });
  }

  update() {
    this.testSphere.position.copy(this.camera.position);
    this.annotationMarkers.forEach((marker) => {
      marker.quaternion.identity();
      const outline = marker.getObjectByName('Annotation outline');
      outline?.quaternion.copy(this.camera.quaternion);
    });
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    this.observer.disconnect();
    this.controls.dispose();
    this.removeSplat();
    this.removeBuilding();
    this.removeProxyGround();
    this.scene.remove(this.sunRotationHandle);
    this.scene.remove(this.testSphere);
    this.testSphere.geometry.dispose();
    this.testSphere.material.dispose();
    this.transformControls.detach();
    this.scene.remove(this.transformControlsHelper);
    this.transformControls.dispose();
    this.scene.remove(this.spark);
    this.spark.dispose();
    this.canvas.removeEventListener('click', this.handleAnnotationClick);
    this.clearAnnotations();
    this.scene.remove(this.annotationRoot);
    this.renderer.dispose();
  }

  private resize(): void {
    const width = Math.max(this.canvas.clientWidth, 1);
    const height = Math.max(this.canvas.clientHeight, 1);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  private removeSplat(): void {
    if (!this.splat) {
      return;
    }

    this.scene.remove(this.splat);
    this.splat.dispose();
    this.splat = undefined;
    this.syncSelectedObject();
  }

  private removeBuilding(): void {
    if (!this.building) {
      return;
    }

    this.scene.remove(this.building);
    this.building.traverse((object) => {
      if (!(object instanceof Mesh)) {
        return;
      }

      object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach(disposeMaterial);
    });
    this.building = undefined;
    this.syncSelectedObject();
  }

  private removeProxyGround(): void {
    if (!this.proxyGround) return;
    this.scene.remove(this.proxyGround);
    this.proxyGround.geometry.dispose();
    const material = this.proxyGround.material;
    if (Array.isArray(material)) material.forEach(disposeMaterial);
    else disposeMaterial(material);
    this.proxyGround = undefined;
  }

  private syncSelectedObject(): void {
    if (!this.transformGizmoVisible) {
      this.transformControls.detach();
      return;
    }
    const selected = this.selectedKind
      ? this.selectedKind === 'environment'
        ? this.splat
        : this.building
      : this.selectedAnnotationId
        ? this.annotationMarkers.get(this.selectedAnnotationId)
        : undefined;
    if (selected) this.transformControls.attach(selected);
    else this.transformControls.detach();
  }

  private clearAnnotations(): void {
    this.annotationMarkers.forEach((marker) => {
      this.annotationRoot.remove(marker);
      marker.traverse((object) => {
        if (object instanceof Mesh) {
          object.geometry.dispose();
          const material = object.material;
          if (Array.isArray(material)) material.forEach(disposeMaterial);
          else disposeMaterial(material);
        }
      });
    });
    this.annotationMarkers.clear();
  }

  private handleAnnotationClick = (event: MouseEvent): void => {
    if (!this.onAnnotationClick || this.transformControls.dragging) return;
    const bounds = this.canvas.getBoundingClientRect();
    this.pointer.set(
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObjects([...this.annotationMarkers.values()], true)[0];
    if (!hit) return;
    let marker: Object3D | null = hit.object;
    while (marker && !marker.userData.annotationId) marker = marker.parent;
    if (marker?.userData.annotationId)
      this.onAnnotationClick(marker.userData.annotationId as string);
  };

  private applySunRotationFromHandle(notify = false): void {
    this.sunLight.position.set(8, 12, 5).applyEuler(this.sunRotationHandle.rotation);
    if (notify) {
      this.onSunRotationChange?.([
        (this.sunRotationHandle.rotation.x * 180) / Math.PI,
        (this.sunRotationHandle.rotation.y * 180) / Math.PI,
        (this.sunRotationHandle.rotation.z * 180) / Math.PI,
      ]);
    }
  }

  private forEachBuildingMaterial(
    callback: (material: Material & { opacity: number; transparent: boolean }) => void,
  ): void {
    this.building?.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach((material) =>
        callback(material as Material & { opacity: number; transparent: boolean }),
      );
    });
  }

  private setState(state: ViewerState): void {
    this.onStateChange?.(state);
  }

  private reportLoadFailure(error: unknown): never {
    const message = error instanceof Error ? error.message : 'The asset could not be loaded.';
    this.setState({ status: 'error', message });
    throw new Error(message, { cause: error });
  }

  private assertActive(): void {
    if (this.disposed) {
      throw new Error('Viewer has been disposed.');
    }
  }
}

function hasUniformScale(transform: Transform): boolean {
  const [x, y, z] = transform.scale;
  return x === y && y === z;
}

function disposeMaterial(material: Material): void {
  for (const value of Object.values(material)) {
    if (value instanceof Texture) {
      value.dispose();
    }
  }
  material.dispose();
}

function createAnnotationMarker(annotation: SceneAnnotation, scale: number): Group {
  const marker = new Group();
  marker.name = `Annotation: ${annotation.title}`;
  marker.userData.annotationId = annotation.id;
  marker.position.fromArray(annotation.position);
  marker.scale.setScalar(scale);

  const circle = new Mesh(
    new CircleGeometry(0.12, 32),
    new ShaderMaterial({
      uniforms: { uColor: { value: new Color(annotation.color) } },
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vNormal;
        varying vec3 vViewPosition;
        void main() {
          vUv = uv;
          vNormal = normalize(normalMatrix * normal);
          vec4 modelViewPosition = modelViewMatrix * vec4(position, 1.0);
          vViewPosition = -modelViewPosition.xyz;
          gl_Position = projectionMatrix * modelViewPosition;
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        varying vec2 vUv;
        varying vec3 vNormal;
        varying vec3 vViewPosition;
        void main() {
          float radius = length(vUv - vec2(0.5)) * 2.0;
          float radialOutline = smoothstep(0.62, 0.84, radius) * (1.0 - smoothstep(0.95, 1.0, radius));
          float fresnel = pow(1.0 - abs(dot(normalize(vNormal), normalize(vViewPosition))), 2.0);
          float outline = max(radialOutline, fresnel);
          if (outline < 0.01) discard;
          gl_FragColor = vec4(uColor, outline);
        }
      `,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  circle.name = 'Annotation outline';
  circle.renderOrder = 10_000;
  marker.add(circle);

  return marker;
}
