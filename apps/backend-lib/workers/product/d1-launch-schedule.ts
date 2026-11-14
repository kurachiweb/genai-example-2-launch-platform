import { and, asc, eq, exists, gt, inArray, isNull, sql } from 'drizzle-orm';
import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { notDeleted } from '../../../db/schema/_shared/columns.ts';
import { users } from '../../../db/schema/identity/users.ts';
import { productLaunches } from '../../../db/schema/product/product-launches.ts';
import { products } from '../../../db/schema/product/products.ts';
import { visibleProducts } from '../../../db/schema/product/visibility.ts';
import { PLATFORM_TYPES } from '../../core/di/identifiers.ts';
import type { QualifierOutcome } from '../../core/product/launch-status.ts';
import type {
  LaunchOutcomeRecorder,
  OutcomeEntry,
  OutcomeRecordResult,
  ScheduledLaunch,
  ScheduledLaunchDirectory,
} from '../../core/product/ports.ts';
import type { BusinessDate } from '../../core/time/business-time.ts';

const MAX_SCHEDULE_PAGE_SIZE = 500;
const MAX_OUTCOME_ENTRIES = 200;

// D1のバインド変数の上限(100)から、IDの一覧以外に使う変数の分を残す
const IDS_PER_STATEMENT = 90;

interface RecordedLaunchRow {
  readonly launchId: string;
  readonly outcome: QualifierOutcome | null;
  readonly cancelledAt: Date | null;
  readonly productDeletedAt: Date | null;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size),
  );
}

function assertPageSize(limit: number): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_SCHEDULE_PAGE_SIZE) {
    throw new RangeError(
      `予定のローンチの件数の上限は1〜${String(MAX_SCHEDULE_PAGE_SIZE)}の整数です(${String(limit)})`,
    );
  }
}

function assertEntries(entries: readonly OutcomeEntry[]): void {
  if (entries.length < 1 || entries.length > MAX_OUTCOME_ENTRIES) {
    throw new RangeError(
      `予選の結果は1回に1〜${String(MAX_OUTCOME_ENTRIES)}件まで記録できます(${String(entries.length)}件)`,
    );
  }
  if (new Set(entries.map((entry) => entry.launchId)).size !== entries.length) {
    throw new RangeError(
      '同じローンチの予選の結果を1回の記録に2件以上含められません',
    );
  }
}

function changesOf(result: unknown): number {
  if (
    typeof result === 'object' &&
    result !== null &&
    'meta' in result &&
    typeof result.meta === 'object' &&
    result.meta !== null &&
    'changes' in result.meta &&
    typeof result.meta.changes === 'number'
  ) {
    return result.meta.changes;
  }
  throw new TypeError('D1の書き込みの結果に変更の件数がありません');
}

function classifyUnchanged(
  entry: OutcomeEntry,
  row: RecordedLaunchRow | undefined,
): OutcomeRecordResult {
  if (
    row === undefined ||
    row.cancelledAt !== null ||
    row.productDeletedAt !== null
  ) {
    return 'not-recordable';
  }
  return row.outcome === entry.outcome ? 'already-recorded' : 'conflict';
}

@injectable()
export class D1ScheduledLaunchDirectory implements ScheduledLaunchDirectory {
  constructor(@inject(PLATFORM_TYPES.Database) private readonly db: Database) {}

  async listForDate(input: {
    readonly launchDate: BusinessDate;
    readonly after: string | undefined;
    readonly limit: number;
  }): Promise<{
    readonly launches: readonly ScheduledLaunch[];
    readonly next: string | undefined;
  }> {
    assertPageSize(input.limit);
    const rows = await this.db
      .select({
        launchId: productLaunches.id,
        productId: productLaunches.productId,
        ownerUserId: products.userId,
        categoryId: products.categoryId,
      })
      .from(productLaunches)
      .innerJoin(products, eq(products.id, productLaunches.productId))
      .innerJoin(users, eq(users.id, products.userId))
      .where(
        and(
          eq(productLaunches.launchDate, input.launchDate),
          isNull(productLaunches.outcome),
          isNull(productLaunches.cancelledAt),
          visibleProducts(),
          input.after === undefined
            ? undefined
            : gt(productLaunches.id, input.after),
        ),
      )
      .orderBy(asc(productLaunches.id))
      .limit(input.limit + 1);
    const launches = rows.slice(0, input.limit);
    return {
      launches,
      next: rows.length > input.limit ? launches.at(-1)?.launchId : undefined,
    };
  }
}

@injectable()
export class D1LaunchOutcomeRecorder implements LaunchOutcomeRecorder {
  constructor(@inject(PLATFORM_TYPES.Database) private readonly db: Database) {}

  async record(
    entries: readonly OutcomeEntry[],
  ): Promise<ReadonlyMap<string, OutcomeRecordResult>> {
    assertEntries(entries);
    const [first, ...rest] = entries.map((entry) =>
      this.recordStatement(entry),
    );
    if (first === undefined) {
      return new Map();
    }
    const results: readonly unknown[] = await this.db.batch([first, ...rest]);
    const unchanged = entries.filter(
      (_, index) => changesOf(results[index]) === 0,
    );
    const rows = await this.readLaunches(
      unchanged.map((entry) => entry.launchId),
    );
    const unchangedIds = new Set(unchanged.map((entry) => entry.launchId));
    return new Map(
      entries.map((entry) => [
        entry.launchId,
        unchangedIds.has(entry.launchId)
          ? classifyUnchanged(entry, rows.get(entry.launchId))
          : 'recorded',
      ]),
    );
  }

  // 確定した結果を書き換えないよう、未確定・取消でない・プロダクトが論理削除されていないことを更新の条件にする
  private recordStatement(entry: OutcomeEntry) {
    return this.db
      .update(productLaunches)
      .set({ outcome: entry.outcome, decidedAt: entry.decidedAt })
      .where(
        and(
          eq(productLaunches.id, entry.launchId),
          isNull(productLaunches.outcome),
          isNull(productLaunches.cancelledAt),
          exists(
            this.db
              .select({ found: sql`1` })
              .from(products)
              .where(
                and(
                  eq(products.id, productLaunches.productId),
                  notDeleted(products.deletedAt),
                ),
              ),
          ),
        ),
      );
  }

  private async readLaunches(
    launchIds: readonly string[],
  ): Promise<ReadonlyMap<string, RecordedLaunchRow>> {
    const pages = await Promise.all(
      chunk(launchIds, IDS_PER_STATEMENT).map((page) =>
        this.db
          .select({
            launchId: productLaunches.id,
            outcome: productLaunches.outcome,
            cancelledAt: productLaunches.cancelledAt,
            productDeletedAt: products.deletedAt,
          })
          .from(productLaunches)
          .innerJoin(products, eq(products.id, productLaunches.productId))
          .where(inArray(productLaunches.id, page)),
      ),
    );
    return new Map(pages.flat().map((row) => [row.launchId, row]));
  }
}
