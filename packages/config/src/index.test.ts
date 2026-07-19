import { expect, test } from 'vitest';
import {
  getAuthenticationEnvironment,
  getServerEnvironment,
  getStorageEnvironment,
} from './index.js';

test('uses safe local-development defaults', () => {
  expect(getServerEnvironment({})).toMatchObject({
    NODE_ENV: 'development',
    PORT: 3001,
    WEB_ORIGIN: 'http://localhost:5173',
  });
});

test('rejects invalid ports', () => {
  expect(() => getServerEnvironment({ PORT: '0' })).toThrow();
});

test('normalizes escaped Firebase private-key newlines', () => {
  const environment = getAuthenticationEnvironment({
    MONGODB_URI: 'mongodb+srv://user:password@example.mongodb.net/gaussian_viewer',
    FIREBASE_PROJECT_ID: 'gaussian-viewer',
    FIREBASE_CLIENT_EMAIL: 'firebase-adminsdk@example.iam.gserviceaccount.com',
    FIREBASE_PRIVATE_KEY: 'line-one\\nline-two',
  });

  expect(environment.FIREBASE_PRIVATE_KEY).toBe('line-one\nline-two');
});

test('loads the server-only S3 credentials', () => {
  expect(
    getStorageEnvironment({
      AWS_REGION: 'eu-central-1',
      AWS_S3_BUCKET: 'gaussian-viewer-development-assets',
      AWS_ACCESS_KEY_ID: 'access-key',
      AWS_SECRET_ACCESS_KEY: 'secret-key',
    }),
  ).toMatchObject({ AWS_REGION: 'eu-central-1' });
});
