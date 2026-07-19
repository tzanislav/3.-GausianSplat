import type { PropsWithChildren } from 'react';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  type User,
  onIdTokenChanged,
  signInWithPopup,
  signOut as firebaseSignOut,
} from 'firebase/auth';
import { firebaseAuth, googleProvider } from './firebase.js';

type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated' | 'error';

interface AuthContextValue {
  status: AuthStatus;
  user: User | null;
  error: string | null;
  signInWithGoogle(): Promise<void>;
  signOut(): Promise<void>;
  authenticatedFetch(input: string, init?: RequestInit): Promise<Response>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: PropsWithChildren) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<User | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const unsubscribe = onIdTokenChanged(firebaseAuth, (nextUser) => {
      if (!nextUser) {
        if (active) {
          setUser(null);
          setStatus('unauthenticated');
        }
        return;
      }

      if (active) {
        setStatus('loading');
      }

      void syncWithApi(nextUser)
        .then(() => {
          if (active) {
            setError(null);
            setUser(nextUser);
            setStatus('authenticated');
          }
        })
        .catch((syncError: unknown) => {
          if (active) {
            setError(syncError instanceof Error ? syncError.message : 'Authentication failed.');
            setUser(null);
            setStatus('error');
          }
        });
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      error,
      async signInWithGoogle() {
        setError(null);
        setStatus('loading');
        try {
          await signInWithPopup(firebaseAuth, googleProvider);
        } catch (signInError) {
          setError(signInError instanceof Error ? signInError.message : 'Google sign-in failed.');
          setStatus('unauthenticated');
        }
      },
      async signOut() {
        await firebaseSignOut(firebaseAuth);
        setUser(null);
        setStatus('unauthenticated');
      },
      async authenticatedFetch(input, init = {}) {
        if (!user) {
          throw new Error('Sign in before making a project request.');
        }
        const token = await user.getIdToken();
        const headers = new Headers(init.headers);
        headers.set('authorization', `Bearer ${token}`);
        return fetch(input, { ...init, headers });
      },
    }),
    [error, status, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider.');
  }
  return context;
}

async function syncWithApi(user: User): Promise<void> {
  const token = await user.getIdToken();
  const response = await fetch('/api/auth/me', {
    headers: { authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    throw new Error('The API could not verify the Firebase session.');
  }
}
