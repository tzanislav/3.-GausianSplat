import { z } from 'zod';

const ServerEnvironmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  WEB_ORIGIN: z.string().url().default('http://localhost:5173'),
});

const AuthenticationEnvironmentSchema = z.object({
  MONGODB_URI: z.string().url().startsWith('mongodb'),
  FIREBASE_PROJECT_ID: z.string().min(1),
  FIREBASE_CLIENT_EMAIL: z.string().email(),
  FIREBASE_PRIVATE_KEY: z.string().min(1),
});

const StorageEnvironmentSchema = z.object({
  AWS_REGION: z.string().min(1),
  AWS_S3_BUCKET: z.string().min(3).max(63),
  AWS_ACCESS_KEY_ID: z.string().min(1),
  AWS_SECRET_ACCESS_KEY: z.string().min(1),
});

export type ServerEnvironment = z.infer<typeof ServerEnvironmentSchema>;
export type AuthenticationEnvironment = z.infer<typeof AuthenticationEnvironmentSchema>;
export type StorageEnvironment = z.infer<typeof StorageEnvironmentSchema>;

export function getServerEnvironment(rawEnvironment: NodeJS.ProcessEnv): ServerEnvironment {
  return ServerEnvironmentSchema.parse({
    NODE_ENV: rawEnvironment.NODE_ENV,
    PORT: rawEnvironment.PORT,
    WEB_ORIGIN: rawEnvironment.WEB_ORIGIN,
  });
}

export function getAuthenticationEnvironment(
  rawEnvironment: NodeJS.ProcessEnv,
): AuthenticationEnvironment {
  const environment = AuthenticationEnvironmentSchema.parse({
    MONGODB_URI: rawEnvironment.MONGODB_URI,
    FIREBASE_PROJECT_ID: rawEnvironment.FIREBASE_PROJECT_ID,
    FIREBASE_CLIENT_EMAIL: rawEnvironment.FIREBASE_CLIENT_EMAIL,
    FIREBASE_PRIVATE_KEY: rawEnvironment.FIREBASE_PRIVATE_KEY,
  });

  return {
    ...environment,
    FIREBASE_PRIVATE_KEY: environment.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  };
}

export function getStorageEnvironment(rawEnvironment: NodeJS.ProcessEnv): StorageEnvironment {
  return StorageEnvironmentSchema.parse({
    AWS_REGION: rawEnvironment.AWS_REGION,
    AWS_S3_BUCKET: rawEnvironment.AWS_S3_BUCKET,
    AWS_ACCESS_KEY_ID: rawEnvironment.AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY: rawEnvironment.AWS_SECRET_ACCESS_KEY,
  });
}
