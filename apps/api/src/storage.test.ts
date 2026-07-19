import { expect, test } from 'vitest';
import { createS3AssetStorage } from './storage.js';

test('requires the checksum in a signed browser request header', async () => {
  const storage = createS3AssetStorage({
    AWS_REGION: 'eu-west-1',
    AWS_S3_BUCKET: 'gaussian-viewer-test-assets',
    AWS_ACCESS_KEY_ID: 'AKIAEXAMPLE0000000000',
    AWS_SECRET_ACCESS_KEY: 'example-secret-key-for-local-signing-only',
  });
  const checksumSha256 = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

  const url = new URL(
    await storage.createUploadUrl({
      key: 'projects/project-1/assets/asset-1/original/test.ply',
      contentType: 'application/octet-stream',
      checksumSha256,
    }),
  );

  expect(url.searchParams.get('x-amz-checksum-sha256')).toBeNull();
  expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('host;x-amz-checksum-sha256');
});

test('signs each multipart part with its checksum and upload ID', async () => {
  const storage = createS3AssetStorage({
    AWS_REGION: 'eu-west-1',
    AWS_S3_BUCKET: 'gaussian-viewer-test-assets',
    AWS_ACCESS_KEY_ID: 'AKIAEXAMPLE0000000000',
    AWS_SECRET_ACCESS_KEY: 'example-secret-key-for-local-signing-only',
  });

  const url = new URL(
    await storage.createMultipartPartUrl({
      key: 'projects/project-1/assets/asset-1/original/test.spz',
      uploadId: 's3-upload-id',
      partNumber: 2,
      checksumSha256: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    }),
  );

  expect(url.searchParams.get('partNumber')).toBe('2');
  expect(url.searchParams.get('uploadId')).toBe('s3-upload-id');
  expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('host;x-amz-checksum-sha256');
});
