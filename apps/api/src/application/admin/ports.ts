import type {
  AuditLogFilter,
  AuditLogLatestManyQuery,
  AuditLogLatestQuery,
  AuditLogPageRequest,
  AuditLogSearchResult,
} from './audit-log-reader.ts';
import type { PreparedAuditEntry } from './audit-log-recorder.ts';

export interface AuditLogStore {
  insert(entry: PreparedAuditEntry): Promise<void>;
  // (occurred_at, id)の降順で、afterはbase64url('<ミリ秒>:<ID>')のカーソル
  search(
    filter: AuditLogFilter,
    page: AuditLogPageRequest,
  ): Promise<AuditLogSearchResult>;
  latestFor(input: AuditLogLatestQuery): Promise<Date | undefined>;
  // targetIdsは重複が無く1件以上で渡される。記録のある対象だけを含める
  latestForMany(
    input: AuditLogLatestManyQuery,
  ): Promise<ReadonlyMap<string, Date>>;
}
