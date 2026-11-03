import {
  and,
  asc,
  desc,
  eq,
  exists,
  gte,
  inArray,
  lt,
  max,
  or,
  type SQL,
} from 'drizzle-orm';
import { inject, injectable } from 'inversify';

import type { AuditTargetKind } from '../../../common-lib/admin/audit-action.ts';
import type { Database } from '../../../db/client.ts';
import { adminAuditLogTargets } from '../../../db/schema/admin/admin-audit-log-targets.ts';
import { adminAuditLogs } from '../../../db/schema/admin/admin-audit-logs.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import { invalidCursorError } from '../../../lib/core/errors/invalid-cursor.ts';
import type {
  AuditLogEntryView,
  AuditLogFilter,
  AuditLogLatestManyQuery,
  AuditLogLatestQuery,
  AuditLogPageRequest,
  AuditLogSearchResult,
} from '../../application/admin/audit-log-reader.ts';
import type { PreparedAuditEntry } from '../../application/admin/audit-log-recorder.ts';
import type { AuditLogStore } from '../../application/admin/ports.ts';
import { buildAuditLogStatements } from './audit-log-statements.ts';

// D1のバインド変数の上限(100)から、操作種別と対象の種類に使う変数の分を残す
const TARGET_IDS_PER_STATEMENT = 90;

const CURSOR_PATTERN = /^(\d{1,15}):([0-9A-Z]{26})$/u;

const BASE64URL_OPTIONS = {
  alphabet: 'base64url',
  omitPadding: true,
} as const;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false });

interface SearchCursor {
  readonly occurredAt: number;
  readonly logId: string;
}

const LOG_COLUMNS = {
  id: adminAuditLogs.id,
  occurredAt: adminAuditLogs.occurredAt,
  operatorAdminId: adminAuditLogs.operatorAdminId,
  action: adminAuditLogs.action,
  targetKind: adminAuditLogs.targetKind,
  reason: adminAuditLogs.reason,
  detail: adminAuditLogs.detail,
};

function encodeCursor(position: SearchCursor): string {
  return textEncoder
    .encode(`${String(position.occurredAt)}:${position.logId}`)
    .toBase64(BASE64URL_OPTIONS);
}

function decodeCursorText(cursor: string): string | undefined {
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.fromBase64(cursor, { alphabet: 'base64url' });
  } catch {
    return undefined;
  }
  // デコードは空白・パディング・末尾の余りのビットを許すため、再エンコードして同じ表記のものだけを受け付ける
  if (bytes.toBase64(BASE64URL_OPTIONS) !== cursor) {
    return undefined;
  }
  try {
    return textDecoder.decode(bytes);
  } catch {
    return undefined;
  }
}

function decodeCursor(cursor: string): SearchCursor {
  const text = decodeCursorText(cursor);
  const [, occurredAt, logId] = CURSOR_PATTERN.exec(text ?? '') ?? [];
  if (occurredAt === undefined || logId === undefined) {
    throw invalidCursorError();
  }
  return { occurredAt: Number(occurredAt), logId };
}

function afterCursor(cursor: string | undefined): SQL | undefined {
  if (cursor === undefined) {
    return undefined;
  }
  const position = decodeCursor(cursor);
  const occurredAt = new Date(position.occurredAt);
  return or(
    lt(adminAuditLogs.occurredAt, occurredAt),
    and(
      eq(adminAuditLogs.occurredAt, occurredAt),
      lt(adminAuditLogs.id, position.logId),
    ),
  );
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size),
  );
}

// 対象の種類の列は登録済みの操作種別の値だけを保存するため、読み出した値をそのまま種類として扱う
function toTargetKind(value: string | null): AuditTargetKind | null {
  return value as AuditTargetKind | null;
}

@injectable()
export class D1AuditLogStore implements AuditLogStore {
  constructor(@inject(PLATFORM_TYPES.Database) private readonly db: Database) {}

  async insert(entry: PreparedAuditEntry): Promise<void> {
    await this.db.batch(buildAuditLogStatements(this.db, entry));
  }

  async search(
    filter: AuditLogFilter,
    page: AuditLogPageRequest,
  ): Promise<AuditLogSearchResult> {
    const rows = await this.db
      .select(LOG_COLUMNS)
      .from(adminAuditLogs)
      .where(
        and(
          filter.operatorAdminId === undefined
            ? undefined
            : eq(adminAuditLogs.operatorAdminId, filter.operatorAdminId),
          filter.action === undefined
            ? undefined
            : eq(adminAuditLogs.action, filter.action),
          this.hasTarget(filter.targetId),
          filter.occurredFrom === undefined
            ? undefined
            : gte(adminAuditLogs.occurredAt, filter.occurredFrom),
          filter.occurredBefore === undefined
            ? undefined
            : lt(adminAuditLogs.occurredAt, filter.occurredBefore),
          afterCursor(page.after),
        ),
      )
      .orderBy(desc(adminAuditLogs.occurredAt), desc(adminAuditLogs.id))
      .limit(page.limit + 1);
    const pageRows = rows.slice(0, page.limit);
    const targetIds = await this.targetIdsOf(pageRows.map((row) => row.id));
    const last = pageRows.at(-1);
    return {
      entries: pageRows.map((row): AuditLogEntryView => ({
        ...row,
        targetKind: toTargetKind(row.targetKind),
        targetIds: targetIds.get(row.id) ?? [],
      })),
      nextCursor:
        rows.length > page.limit && last !== undefined
          ? encodeCursor({
              occurredAt: last.occurredAt.getTime(),
              logId: last.id,
            })
          : null,
    };
  }

  async latestFor(input: AuditLogLatestQuery): Promise<Date | undefined> {
    const [row] = await this.db
      .select({ latest: max(adminAuditLogs.occurredAt) })
      .from(adminAuditLogTargets)
      .innerJoin(
        adminAuditLogs,
        eq(adminAuditLogs.id, adminAuditLogTargets.logId),
      )
      .where(
        and(
          eq(adminAuditLogTargets.targetKind, input.targetKind),
          eq(adminAuditLogTargets.targetId, input.targetId),
          eq(adminAuditLogs.action, input.action),
        ),
      );
    return row?.latest ?? undefined;
  }

  async latestForMany(
    input: AuditLogLatestManyQuery,
  ): Promise<ReadonlyMap<string, Date>> {
    const chunks = chunk(
      [...new Set(input.targetIds)],
      TARGET_IDS_PER_STATEMENT,
    );
    const results = await Promise.all(
      chunks.map((targetIds) =>
        this.db
          .select({
            targetId: adminAuditLogTargets.targetId,
            latest: max(adminAuditLogs.occurredAt),
          })
          .from(adminAuditLogTargets)
          .innerJoin(
            adminAuditLogs,
            eq(adminAuditLogs.id, adminAuditLogTargets.logId),
          )
          .where(
            and(
              eq(adminAuditLogTargets.targetKind, input.targetKind),
              inArray(adminAuditLogTargets.targetId, targetIds),
              eq(adminAuditLogs.action, input.action),
            ),
          )
          .groupBy(adminAuditLogTargets.targetId),
      ),
    );
    return new Map(
      results
        .flat()
        .flatMap(({ targetId, latest }) =>
          latest === null ? [] : [[targetId, latest] as const],
        ),
    );
  }

  // 対象の行の種類を記録の種類にそろえ、(target_kind, target_id, log_id)の索引で絞り込む
  private hasTarget(targetId: string | undefined): SQL | undefined {
    if (targetId === undefined) {
      return undefined;
    }
    return exists(
      this.db
        .select({ logId: adminAuditLogTargets.logId })
        .from(adminAuditLogTargets)
        .where(
          and(
            eq(adminAuditLogTargets.targetKind, adminAuditLogs.targetKind),
            eq(adminAuditLogTargets.targetId, targetId),
            eq(adminAuditLogTargets.logId, adminAuditLogs.id),
          ),
        ),
    );
  }

  private async targetIdsOf(
    logIds: readonly string[],
  ): Promise<ReadonlyMap<string, readonly string[]>> {
    if (logIds.length === 0) {
      return new Map();
    }
    const rows = await this.db
      .select({
        logId: adminAuditLogTargets.logId,
        targetId: adminAuditLogTargets.targetId,
      })
      .from(adminAuditLogTargets)
      .where(inArray(adminAuditLogTargets.logId, [...logIds]))
      .orderBy(asc(adminAuditLogTargets.id));
    return new Map(
      [...Map.groupBy(rows, (row) => row.logId)].map(
        ([logId, targets]) =>
          [logId, targets.map((target) => target.targetId)] as const,
      ),
    );
  }
}
