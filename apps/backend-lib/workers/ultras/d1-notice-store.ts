import { and, asc, eq, inArray, lte, type SQL } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { ultrasNotices } from '../../../db/schema/ultras/ultras-notices.ts';
import { PLATFORM_TYPES } from '../../core/di/identifiers.ts';
import type {
  NoticeStore,
  UltrasNoticeKind,
  UltrasNoticeRow,
  UltrasNoticeStatus,
} from '../../core/ultras/ports.ts';
import type { NoticeStatements } from './statement-contracts.ts';

type NoticeTableRow = typeof ultrasNotices.$inferSelect;

type FinishedStatus = Exclude<UltrasNoticeStatus, 'pending'>;

const notices = ultrasNotices;

// 依頼待ちは日次の確認が依頼し直すため、依頼を終えた状態の行だけを削除の対象にする
const FINISHED_STATUSES: readonly FinishedStatus[] = ['requested', 'skipped'];

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((item) => typeof item === 'string')
  );
}

function parsePayload(
  noticeId: string,
  json: string,
): Readonly<Record<string, string>> {
  const value: unknown = JSON.parse(json);
  if (isStringRecord(value)) {
    return value;
  }
  throw new TypeError(`メールの依頼${noticeId}の内容の形式が不正です。`);
}

function toRow(row: NoticeTableRow): UltrasNoticeRow {
  return {
    id: row.id,
    userId: row.userId,
    stripeSubscriptionId: row.stripeSubscriptionId,
    kind: row.kind,
    dedupeKey: row.dedupeKey,
    payload: parsePayload(row.id, row.payloadJson),
    status: row.status,
    finishedAt: row.finishedAt,
    createdAt: row.createdAt,
  };
}

@injectable()
export class D1NoticeStore implements NoticeStore, NoticeStatements {
  constructor(@inject(PLATFORM_TYPES.Database) private readonly db: Database) {}

  async findPendingBySubscription(
    stripeSubscriptionId: string,
  ): Promise<readonly UltrasNoticeRow[]> {
    return this.findPending(
      eq(notices.stripeSubscriptionId, stripeSubscriptionId),
    );
  }

  async findPendingBefore(
    threshold: Date,
    limit: number,
  ): Promise<readonly UltrasNoticeRow[]> {
    return this.findPending(lte(notices.createdAt, threshold), limit);
  }

  async markRequested(
    id: string,
    at: Date,
  ): Promise<'updated' | 'not_pending'> {
    const changed = await this.finish(id, 'requested', at);
    return changed > 0 ? 'updated' : 'not_pending';
  }

  async markSkipped(id: string, at: Date): Promise<void> {
    await this.finish(id, 'skipped', at);
  }

  // SQLiteのDELETEはLIMITを持たないため、上限の件数のIDを副問い合わせで絞って1つの文で消す
  async deleteFinishedBefore(threshold: Date, limit: number): Promise<number> {
    const expiredIds = this.db
      .select({ id: notices.id })
      .from(notices)
      .where(
        and(
          inArray(notices.status, [...FINISHED_STATUSES]),
          lte(notices.finishedAt, threshold),
        ),
      )
      .orderBy(asc(notices.finishedAt), asc(notices.id))
      .limit(limit);
    const result = await this.db
      .delete(notices)
      .where(inArray(notices.id, expiredIds));
    return result.meta.changes;
  }

  insertIfAbsent(input: {
    readonly id: string;
    readonly userId: string;
    readonly stripeSubscriptionId: string;
    readonly kind: UltrasNoticeKind;
    readonly dedupeKey: string;
    readonly payload: Readonly<Record<string, string>>;
  }): BatchItem<'sqlite'> {
    const { payload, ...columns } = input;
    return this.db
      .insert(notices)
      .values({ ...columns, payloadJson: JSON.stringify(payload) })
      .onConflictDoNothing({ target: notices.dedupeKey });
  }

  deleteByUser(userId: string): BatchItem<'sqlite'> {
    return this.db.delete(notices).where(eq(notices.userId, userId));
  }

  private async findPending(
    condition: SQL,
    limit?: number,
  ): Promise<readonly UltrasNoticeRow[]> {
    const query = this.db
      .select()
      .from(notices)
      .where(and(eq(notices.status, 'pending'), condition))
      .orderBy(asc(notices.createdAt), asc(notices.id));
    const rows = await (limit === undefined ? query : query.limit(limit));
    return rows.map(toRow);
  }

  // 依頼待ちのときだけ状態を進めて完了の時刻を書き、変えた行の数を返す
  private async finish(
    id: string,
    status: FinishedStatus,
    at: Date,
  ): Promise<number> {
    const result = await this.db
      .update(notices)
      .set({ status, finishedAt: at })
      .where(and(eq(notices.id, id), eq(notices.status, 'pending')));
    return result.meta.changes;
  }
}
