import { and, desc, eq, gt, inArray, lt } from 'drizzle-orm';
import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { dataExports } from '../../../db/schema/data-export/data-exports.ts';
import { PLATFORM_TYPES } from '../../core/di/identifiers.ts';
import type {
  DataExportRecord,
  DataExportStore,
} from '../../core/data-export/ports.ts';

const REMOVE_CHUNK_SIZE = 90;

type StoredExport = typeof dataExports.$inferSelect;

type ImplementedOperation =
  | 'create'
  | 'remove'
  | 'find'
  | 'findOwnedReady'
  | 'listByUserPage'
  | 'listForUser'
  | 'removeMany';

function toRecord(row: StoredExport): DataExportRecord {
  return {
    id: row.id,
    userId: row.userId,
    status: row.status,
    requestedAt: row.requestedAt,
    runToken: row.runToken,
    leaseExpiresAt: row.leaseExpiresAt,
    attempts: row.attempts,
    uploadId: row.uploadId,
    objectKey: row.objectKey,
    fileName: row.fileName,
    byteSize: row.byteSize,
    completedAt: row.completedAt,
    expiresAt: row.expiresAt,
    failedAt: row.failedAt,
    failureKind: row.failureKind,
    noticeStatus: row.noticeStatus,
    updatedAt: row.updatedAt,
  };
}

@injectable()
export class D1DataExportStore implements Pick<
  DataExportStore,
  ImplementedOperation
> {
  constructor(@inject(PLATFORM_TYPES.Database) private readonly db: Database) {}

  async create(input: {
    readonly id: string;
    readonly userId: string;
    readonly requestedAt: Date;
  }): Promise<DataExportRecord> {
    const [row] = await this.db
      .insert(dataExports)
      .values({
        id: input.id,
        userId: input.userId,
        status: 'queued',
        requestedAt: input.requestedAt,
        createdAt: input.requestedAt,
        updatedAt: input.requestedAt,
      })
      .returning();
    if (row === undefined) {
      throw new Error('データエクスポートの要求の記録を作れなかった');
    }
    return toRecord(row);
  }

  async remove(id: string): Promise<void> {
    await this.db.delete(dataExports).where(eq(dataExports.id, id));
  }

  async find(id: string): Promise<DataExportRecord | undefined> {
    const [row] = await this.db
      .select()
      .from(dataExports)
      .where(eq(dataExports.id, id))
      .limit(1);
    return row === undefined ? undefined : toRecord(row);
  }

  async findOwnedReady(input: {
    readonly id: string;
    readonly userId: string;
    readonly now: Date;
  }): Promise<DataExportRecord | undefined> {
    const [row] = await this.db
      .select()
      .from(dataExports)
      .where(
        and(
          eq(dataExports.id, input.id),
          eq(dataExports.userId, input.userId),
          eq(dataExports.status, 'ready'),
          gt(dataExports.expiresAt, input.now),
        ),
      )
      .limit(1);
    return row === undefined ? undefined : toRecord(row);
  }

  async listByUserPage(input: {
    readonly userId: string;
    readonly afterId: string | undefined;
    readonly limit: number;
  }): Promise<readonly DataExportRecord[]> {
    const owned = eq(dataExports.userId, input.userId);
    const rows = await this.db
      .select()
      .from(dataExports)
      .where(
        input.afterId === undefined
          ? owned
          : and(owned, lt(dataExports.id, input.afterId)),
      )
      .orderBy(desc(dataExports.id))
      .limit(input.limit + 1);
    return rows.map(toRecord);
  }

  async listForUser(input: {
    readonly userId: string;
    readonly limit: number;
  }): Promise<readonly DataExportRecord[]> {
    const rows = await this.db
      .select()
      .from(dataExports)
      .where(eq(dataExports.userId, input.userId))
      .orderBy(desc(dataExports.id))
      .limit(input.limit);
    return rows.map(toRecord);
  }

  // D1は1文あたりのバインド変数が100個までのため、IDを分けて1回の一括の書き込みで消す
  async removeMany(ids: readonly string[]): Promise<void> {
    const statements = [];
    for (let start = 0; start < ids.length; start += REMOVE_CHUNK_SIZE) {
      statements.push(
        this.db
          .delete(dataExports)
          .where(
            inArray(
              dataExports.id,
              ids.slice(start, start + REMOVE_CHUNK_SIZE),
            ),
          ),
      );
    }
    const [first, ...rest] = statements;
    if (first !== undefined) {
      await this.db.batch([first, ...rest]);
    }
  }
}
