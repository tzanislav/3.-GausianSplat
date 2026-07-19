import type { AuthenticationEnvironment } from '@gaussian-viewer/config';
import type { FirebaseUser } from '@gaussian-viewer/contracts';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

export interface TokenVerifier {
  verifyIdToken(idToken: string): Promise<FirebaseUser>;
}

export function createFirebaseTokenVerifier(environment: AuthenticationEnvironment): TokenVerifier {
  const app = getFirebaseAdminApp(environment);
  const firebaseAuth = getAuth(app);

  return {
    async verifyIdToken(idToken) {
      const token = await firebaseAuth.verifyIdToken(idToken);
      return {
        firebaseUid: token.uid,
        email: typeof token.email === 'string' ? token.email : null,
        displayName: typeof token.name === 'string' ? token.name : null,
        photoUrl: typeof token.picture === 'string' ? token.picture : null,
      };
    },
  };
}

export async function checkFirebaseAdminConnection(
  environment: AuthenticationEnvironment,
): Promise<void> {
  const credential = getFirebaseAdminApp(environment).options.credential;
  if (!credential) {
    throw new Error('Firebase Admin credential is not configured.');
  }
  await credential.getAccessToken();
}

function getFirebaseAdminApp(environment: AuthenticationEnvironment) {
  return (
    getApps()[0] ??
    initializeApp({
      credential: cert({
        projectId: environment.FIREBASE_PROJECT_ID,
        clientEmail: environment.FIREBASE_CLIENT_EMAIL,
        privateKey: environment.FIREBASE_PRIVATE_KEY,
      }),
      projectId: environment.FIREBASE_PROJECT_ID,
    })
  );
}
