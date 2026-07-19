import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  HeadBucketCommand,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { StorageEnvironment } from '@gaussian-viewer/config';

const UPLOAD_URL_TTL_SECONDS = 10 * 60;
const DOWNLOAD_URL_TTL_SECONDS = 5 * 60;

export interface AssetStorage {
  createUploadUrl(input: {
    key: string;
    contentType: string;
    checksumSha256: string;
  }): Promise<string>;
  createDownloadUrl(key: string): Promise<string>;
  getObjectMetadata(key: string): Promise<{
    contentLength: number | undefined;
    checksumSha256: string | undefined;
  }>;
  getObjectHeader(key: string): Promise<Uint8Array>;
  createMultipartUpload(input: { key: string; contentType: string }): Promise<string>;
  createMultipartPartUrl(input: {
    key: string;
    uploadId: string;
    partNumber: number;
    checksumSha256: string;
  }): Promise<string>;
  completeMultipartUpload(input: {
    key: string;
    uploadId: string;
    parts: Array<{ partNumber: number; etag: string; checksumSha256: string }>;
  }): Promise<void>;
  abortMultipartUpload(input: { key: string; uploadId: string }): Promise<void>;
}

export function createS3AssetStorage(environment: StorageEnvironment): AssetStorage {
  const client = createS3Client(environment);

  return {
    createUploadUrl({ key, contentType, checksumSha256 }) {
      return getSignedUrl(
        client,
        new PutObjectCommand({
          Bucket: environment.AWS_S3_BUCKET,
          Key: key,
          ContentType: contentType,
          ChecksumSHA256: checksumSha256,
        }),
        {
          expiresIn: UPLOAD_URL_TTL_SECONDS,
          unhoistableHeaders: new Set(['x-amz-checksum-sha256']),
        },
      );
    },
    createDownloadUrl(key) {
      return getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: environment.AWS_S3_BUCKET,
          Key: key,
          ResponseContentDisposition: 'attachment',
        }),
        { expiresIn: DOWNLOAD_URL_TTL_SECONDS },
      );
    },
    async getObjectMetadata(key) {
      const object = await client.send(
        new HeadObjectCommand({
          Bucket: environment.AWS_S3_BUCKET,
          Key: key,
          ChecksumMode: 'ENABLED',
        }),
      );
      return {
        contentLength: object.ContentLength,
        checksumSha256: object.ChecksumSHA256,
      };
    },
    async getObjectHeader(key) {
      const object = await client.send(
        new GetObjectCommand({
          Bucket: environment.AWS_S3_BUCKET,
          Key: key,
          Range: 'bytes=0-31',
        }),
      );
      if (!object.Body) {
        throw new Error('S3 returned an object without a body.');
      }
      return object.Body.transformToByteArray();
    },
    async createMultipartUpload({ key, contentType }) {
      const response = await client.send(
        new CreateMultipartUploadCommand({
          Bucket: environment.AWS_S3_BUCKET,
          Key: key,
          ContentType: contentType,
          ChecksumAlgorithm: 'SHA256',
        }),
      );
      if (!response.UploadId) {
        throw new Error('S3 did not create a multipart upload ID.');
      }
      return response.UploadId;
    },
    createMultipartPartUrl({ key, uploadId, partNumber, checksumSha256 }) {
      return getSignedUrl(
        client,
        new UploadPartCommand({
          Bucket: environment.AWS_S3_BUCKET,
          Key: key,
          UploadId: uploadId,
          PartNumber: partNumber,
          ChecksumSHA256: checksumSha256,
        }),
        {
          expiresIn: UPLOAD_URL_TTL_SECONDS,
          unhoistableHeaders: new Set(['x-amz-checksum-sha256']),
        },
      );
    },
    async completeMultipartUpload({ key, uploadId, parts }) {
      await client.send(
        new CompleteMultipartUploadCommand({
          Bucket: environment.AWS_S3_BUCKET,
          Key: key,
          UploadId: uploadId,
          MultipartUpload: {
            Parts: parts.map((part) => ({
              PartNumber: part.partNumber,
              ETag: part.etag,
              ChecksumSHA256: part.checksumSha256,
            })),
          },
        }),
      );
    },
    async abortMultipartUpload({ key, uploadId }) {
      await client.send(
        new AbortMultipartUploadCommand({
          Bucket: environment.AWS_S3_BUCKET,
          Key: key,
          UploadId: uploadId,
        }),
      );
    },
  };
}

export async function checkS3BucketConnection(
  environment: StorageEnvironment,
): Promise<'available' | 'reachable (bucket probe was denied)'> {
  try {
    await createS3Client(environment).send(
      new HeadBucketCommand({ Bucket: environment.AWS_S3_BUCKET }),
    );
    return 'available';
  } catch (error) {
    if (getHttpStatusCode(error) === 403) {
      return 'reachable (bucket probe was denied)';
    }
    throw error;
  }
}

function createS3Client(environment: StorageEnvironment): S3Client {
  return new S3Client({
    region: environment.AWS_REGION,
    credentials: {
      accessKeyId: environment.AWS_ACCESS_KEY_ID,
      secretAccessKey: environment.AWS_SECRET_ACCESS_KEY,
    },
  });
}

function getHttpStatusCode(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('$metadata' in error)) {
    return undefined;
  }
  const metadata = error.$metadata;
  if (typeof metadata !== 'object' || metadata === null || !('httpStatusCode' in metadata)) {
    return undefined;
  }
  return typeof metadata.httpStatusCode === 'number' ? metadata.httpStatusCode : undefined;
}

export const assetStorageTimings = {
  uploadUrlTtlSeconds: UPLOAD_URL_TTL_SECONDS,
  downloadUrlTtlSeconds: DOWNLOAD_URL_TTL_SECONDS,
};
