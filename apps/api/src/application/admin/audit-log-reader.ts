import { inject, injectable } from 'inversify';

import type { AuditTargetKind } from '../../../common-lib/admin/audit-action.ts';
import { ADMIN_TYPES } from './admin-types.ts';
import type { AuditLogStore } from './ports.ts';

export interface AuditLogEntryView {
  readonly id: string;
  readonly occurredAt: Date;
  readonly operatorAdminId: string;
  readonly action: string;
  readonly targetKind: AuditTargetKind | null;
  readonly targetIds: readonly string[];
  readonly reason: string | null;
  readonly detail: Readonly<Record<string, string>>;
}

export interface AuditLogFilter {
  readonly operatorAdminId?: string;
  readonly action?: string;
  readonly targetId?: string;
  readonly occurredFrom?: Date;
  readonly occurredBefore?: Date;
}

export const AUDIT_LOG_PAGE_SIZE = 50;

export interface AuditLogPageRequest {
  readonly after?: string;
  readonly limit: typeof AUDIT_LOG_PAGE_SIZE;
}

export interface AuditLogSearchResult {
  readonly entries: readonly AuditLogEntryView[];
  readonly nextCursor: string | null;
}

export interface AuditLogLatestQuery {
  readonly action: string;
  readonly targetKind: AuditTargetKind;
  readonly targetId: string;
}

export interface AuditLogLatestManyQuery {
  readonly action: string;
  readonly targetKind: AuditTargetKind;
  readonly targetIds: readonly string[];
}

export interface AuditLogReader {
  search(
    filter: AuditLogFilter,
    page: AuditLogPageRequest,
  ): Promise<AuditLogSearchResult>;
  latestFor(input: AuditLogLatestQuery): Promise<Date | undefined>;
  // 記録のある対象だけを含める
  latestForMany(
    input: AuditLogLatestManyQuery,
  ): Promise<ReadonlyMap<string, Date>>;
}

@injectable()
export class StoreAuditLogReader implements AuditLogReader {
  constructor(
    @inject(ADMIN_TYPES.AuditLogStore)
    private readonly store: AuditLogStore,
  ) {}

  search(
    filter: AuditLogFilter,
    page: AuditLogPageRequest,
  ): Promise<AuditLogSearchResult> {
    return this.store.search(filter, page);
  }

  latestFor(input: AuditLogLatestQuery): Promise<Date | undefined> {
    return this.store.latestFor(input);
  }

  async latestForMany(
    input: AuditLogLatestManyQuery,
  ): Promise<ReadonlyMap<string, Date>> {
    const targetIds = [...new Set(input.targetIds)];
    if (targetIds.length === 0) {
      return new Map();
    }
    return this.store.latestForMany({ ...input, targetIds });
  }
}
