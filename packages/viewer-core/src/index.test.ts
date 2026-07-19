import { Object3D } from 'three';
import { expect, test } from 'vitest';
import {
  DESKTOP_QUALITY_PROFILE,
  applyTransform,
  createTransformFromEulerDegrees,
  getTransformEulerDegrees,
  getRuntimeFileWarning,
  setTransformEulerDegrees,
  transformFromObject,
  validateRuntimeFile,
} from './index.js';

test('applies a canonical transform and normalizes its quaternion', () => {
  const object = new Object3D();

  applyTransform(object, {
    position: [1, 2, 3],
    quaternion: [0, 0, 0, 2],
    scale: [2, 3, 4],
  });

  expect(object.position.toArray()).toEqual([1, 2, 3]);
  expect(object.quaternion.w).toBe(1);
  expect(object.scale.toArray()).toEqual([2, 3, 4]);
});

test('reads a gizmo-updated object back into a canonical transform', () => {
  const object = new Object3D();
  object.position.set(4, 5, 6);
  object.quaternion.set(0, 0, 0, 2);
  object.scale.set(2, 3, 4);

  const transform = transformFromObject(object);

  expect(transform.position).toEqual([4, 5, 6]);
  expect(transform.quaternion[3]).toBe(1);
  expect(transform.scale).toEqual([2, 3, 4]);
});

test('converts Euler degrees to a canonical uniform-scale transform', () => {
  const transform = createTransformFromEulerDegrees([3, 4, 5], [0, 90, 0], 2);

  expect(transform.position).toEqual([3, 4, 5]);
  expect(transform.scale).toEqual([2, 2, 2]);
  expect(transform.quaternion[1]).toBeCloseTo(Math.SQRT1_2);
  expect(transform.quaternion[3]).toBeCloseTo(Math.SQRT1_2);
});

test('updates an existing transform rotation without changing its non-uniform scale', () => {
  const initial = {
    position: [3, 4, 5] as [number, number, number],
    quaternion: [0, 0, 0, 1] as [number, number, number, number],
    scale: [2, 3, 4] as [number, number, number],
  };
  const updated = setTransformEulerDegrees(initial, [0, 90, 0]);

  expect(updated.position).toEqual(initial.position);
  expect(updated.scale).toEqual(initial.scale);
  expect(getTransformEulerDegrees(updated)[1]).toBeCloseTo(90);
});

test('accepts direct PLY environments and rejects unsupported files', () => {
  expect(() =>
    validateRuntimeFile({ name: 'environment.ply', size: 1 }, 'environment'),
  ).not.toThrow();

  expect(() => validateRuntimeFile({ name: 'environment.splat', size: 1 }, 'environment')).toThrow(
    '.ply or .spz',
  );
});

test('warns above the profile size budget without rejecting the asset', () => {
  const warning = getRuntimeFileWarning(
    { name: 'building.glb', size: DESKTOP_QUALITY_PROFILE.buildingWarningBytes + 1 },
    'building',
    DESKTOP_QUALITY_PROFILE,
  );

  expect(warning).toContain('100 MiB');
});
