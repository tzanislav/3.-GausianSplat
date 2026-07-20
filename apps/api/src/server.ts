import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { checkFirebaseAdminConnection, createFirebaseTokenVerifier } from '@gaussian-viewer/auth';
import {
  getAuthenticationEnvironment,
  getServerEnvironment,
  getStorageEnvironment,
} from '@gaussian-viewer/config';
import { createMongoRepositories } from '@gaussian-viewer/database';
import { createApp } from './app.js';
import { checkS3BucketConnection, createS3AssetStorage } from './storage.js';

const localEnvironmentPath = resolve(import.meta.dirname, '../../../.env');
if (existsSync(localEnvironmentPath)) {
  process.loadEnvFile(localEnvironmentPath);
}

const environment = getServerEnvironment(process.env);
const authenticationEnvironment = getAuthenticationEnvironment(process.env);
const storageEnvironment = getStorageEnvironment(process.env);
const database = createMongoRepositories(authenticationEnvironment.MONGODB_URI);
const app = createApp({
  tokenVerifier: createFirebaseTokenVerifier(authenticationEnvironment),
  users: database.users,
  projects: database.projects,
  scenes: database.scenes,
  assets: database.assets,
  uploadSessions: database.uploadSessions,
  shares: database.shares,
  annotationComments: database.annotationComments,
  storage: createS3AssetStorage(storageEnvironment),
});

const server = app.listen(environment.PORT, () => {
  console.info(`API listening on http://localhost:${environment.PORT}`);
  void reportConnectionStatus();
});

async function shutdown() {
  server.close();
  await database.close();
}

process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());

async function reportConnectionStatus() {
  await Promise.all([
    reportConnection('MongoDB', () => database.ping()),
    reportConnection('Firebase Admin', () =>
      checkFirebaseAdminConnection(authenticationEnvironment),
    ),
    reportConnection('S3 bucket', () => checkS3BucketConnection(storageEnvironment)),
  ]);
}

async function reportConnection(name: string, check: () => Promise<string | void>) {
  try {
    const status = await check();
    console.info(`[connection] ${name}: ${status ?? 'available'}`);
  } catch (error) {
    const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    console.error(`[connection] ${name}: unavailable (${detail})`);
  }
}
