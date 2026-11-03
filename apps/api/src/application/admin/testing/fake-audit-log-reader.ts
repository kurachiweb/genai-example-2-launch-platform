import type { AuditLogReader } from '../audit-log-reader.ts';

// AuditLogReaderにメソッドを足すときは既定の振る舞いもここへ足し、各specの単体テストの偽物を型検査で壊さない
export function createFakeAuditLogReader(
  overrides: Partial<AuditLogReader> = {},
): AuditLogReader {
  return {
    search:
      overrides.search ??
      (() => Promise.resolve({ entries: [], nextCursor: null })),
    latestFor: overrides.latestFor ?? (() => Promise.resolve(undefined)),
    latestForMany:
      overrides.latestForMany ?? (() => Promise.resolve(new Map())),
  };
}
