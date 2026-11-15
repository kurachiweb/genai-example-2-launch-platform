import {
  and,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  type SQL,
} from 'drizzle-orm';
import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { notDeleted } from '../../../db/schema/_shared/columns.ts';
import { productRatings } from '../../../db/schema/engagement/product-ratings.ts';
import type { RatingScore } from '../../../common-lib/engagement/engagement-rules.ts';
import { PLATFORM_TYPES } from '../../core/di/identifiers.ts';
import type {
  AdminDirectoryPage,
  AdminRatingDirectory,
  AdminRatingRecord,
  AdminRatingSearchFilter,
  AdminRatingState,
} from '../../core/engagement/ports.ts';
import { afterCursor, assertPageSize, toPage } from './admin-directory-page.ts';

// D1のバインド変数の上限(100)から、IDの一覧以外に使う変数の分を残す
const IDS_PER_STATEMENT = 90;

function chunk<T>(items: readonly T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size),
  );
}

const RECORD_COLUMNS = {
  ratingId: productRatings.id,
  productId: productRatings.productId,
  userId: productRatings.userId,
  score: productRatings.score,
  invalidatedAt: productRatings.invalidatedAt,
  createdAt: productRatings.createdAt,
  updatedAt: productRatings.updatedAt,
};

interface RatingRow {
  readonly ratingId: string;
  readonly productId: string;
  readonly userId: string;
  readonly score: number;
  readonly invalidatedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

// 値はテーブルのCHECK制約で1〜5に限られる
function toRecord(row: RatingRow): AdminRatingRecord {
  return { ...row, score: row.score as RatingScore };
}

// 評価者の停止は状態に含めず、無効化の印の有無だけで決める
function stateCondition(state: AdminRatingState): SQL {
  return state === 'invalidated'
    ? isNotNull(productRatings.invalidatedAt)
    : isNull(productRatings.invalidatedAt);
}

function filterConditions(filter: AdminRatingSearchFilter): SQL | undefined {
  return and(
    filter.productId === undefined
      ? undefined
      : eq(productRatings.productId, filter.productId),
    filter.userId === undefined
      ? undefined
      : eq(productRatings.userId, filter.userId),
    filter.state === undefined ? undefined : stateCondition(filter.state),
  );
}

@injectable()
export class D1AdminRatingDirectory implements AdminRatingDirectory {
  constructor(@inject(PLATFORM_TYPES.Database) private readonly db: Database) {}

  async search(
    filter: AdminRatingSearchFilter,
    page: AdminDirectoryPage,
  ): Promise<{
    readonly ratings: readonly AdminRatingRecord[];
    readonly nextCursor: string | null;
  }> {
    assertPageSize(page.limit);
    const rows: RatingRow[] = await this.db
      .select(RECORD_COLUMNS)
      .from(productRatings)
      .where(
        and(
          notDeleted(productRatings.deletedAt),
          filterConditions(filter),
          afterCursor(
            { at: productRatings.updatedAt, id: productRatings.id },
            page.after,
          ),
        ),
      )
      .orderBy(desc(productRatings.updatedAt), desc(productRatings.id))
      .limit(page.limit + 1);
    const { rows: pageRows, nextCursor } = toPage(rows, page, (row) => ({
      at: row.updatedAt,
      id: row.ratingId,
    }));
    return { ratings: pageRows.map(toRecord), nextCursor };
  }

  async findByIds(
    ratingIds: readonly string[],
  ): Promise<ReadonlyMap<string, AdminRatingRecord>> {
    const pages = await Promise.all(
      chunk([...new Set(ratingIds)], IDS_PER_STATEMENT).map((page) =>
        this.db
          .select(RECORD_COLUMNS)
          .from(productRatings)
          .where(
            and(
              inArray(productRatings.id, page),
              notDeleted(productRatings.deletedAt),
            ),
          ),
      ),
    );
    return new Map(pages.flat().map((row) => [row.ratingId, toRecord(row)]));
  }
}
