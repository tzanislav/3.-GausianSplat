import type { ProjectSummary } from '@gaussian-viewer/contracts';

export function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong.';
}

export function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value),
  );
}

export function formatAssetStatus(status: ProjectSummary['assetStatus']): string {
  if (status === 'NO_ASSETS') return 'No assets';
  return status === 'ASSETS_READY' ? 'Files ready' : 'Files processing';
}

export function formatShareStatus(status: ProjectSummary['shareStatus']): string {
  return status === 'NOT_SHARED' ? 'Not shared' : status;
}
