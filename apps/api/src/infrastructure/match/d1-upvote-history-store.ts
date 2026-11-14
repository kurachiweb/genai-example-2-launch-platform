import {
  and,
  count,
  desc,
  eq,
  inArray,
  isNull,
  lt,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { users } from '../../../db/schema/identity/users.ts';
import { matchEntries } from '../../../db/schema/match/match-entries.ts';
import { matchUpvotes } from '../../../db/schema/match/match-upvotes.ts';
import { products } from '../../../db/schema/product/products.ts';
import { visibleProducts } from '../../../db/schema/product/visibility.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import {
  type BusinessDate,
  parseBusinessDate,
} from '../../../lib/core/time/business-time.ts';
import type {
  UpvoteHistoryPosition,
  UpvoteHistoryRecord,
  UpvoteHistoryStore,
} from '../../application/match/ports.ts';

// D1のバインド変数の上限(100)から、日付の一覧以外に使う変数の分を残す
const DATES_PER_STATEMENT = 90;

function chunk<T>(items: readonly T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size),
  );
}

// 紐付けを解除した側は内部結合で落ち、投稿者の状態はproductsに結合したusersで見る
function historyCondition(userId: string): SQL | undefined {
  return and(
    eq(matchUpvotes.userId, userId),
    isNull(matchUpvotes.deletedAt),
    visibleProducts(),
  );
}

const anchor = alias(matchUpvotes, 'upvote_history_anchor');

// 続きの位置はマッチのIDだけを持つため、その利用者のそのマッチの有効なUpvoteの日時とIDを同じ文の中で引いて比べる。
// 読み込みの間に取り消されると比べる行が無くなり、行の値の比較がNULLになるため、位置の実施日より前の実施日だけから続ける(その日の残りは読み直しで表示される)。読み込みの間に本人が位置のマッチを付け替えると新しい日時の行を比べるため、続きのページに既出の項目が含まれ得る。画面は続きのページを足すときにマッチのIDで重複を除く
function positionCondition(
  userId: string,
  before: UpvoteHistoryPosition | undefined,
): SQL | undefined {
  if (before === undefined) {
    return undefined;
  }
  const anchorRow = sql`(select ${anchor.upvotedAt}, ${anchor.id} from ${matchUpvotes} as ${anchor} where ${and(
    eq(anchor.userId, userId),
    eq(anchor.matchId, before.matchId),
    eq(anchor.matchDate, before.matchDate),
    isNull(anchor.deletedAt),
  )})`;
  return or(
    lt(matchUpvotes.matchDate, before.matchDate),
    and(
      eq(matchUpvotes.matchDate, before.matchDate),
      sql`(${matchUpvotes.upvotedAt}, ${matchUpvotes.id}) < ${anchorRow}`,
    ),
  );
}

@injectable()
export class D1UpvoteHistoryStore implements UpvoteHistoryStore {
  constructor(@inject(PLATFORM_TYPES.Database) private readonly db: Database) {}

  async count(userId: string): Promise<number> {
    const [row] = await this.db
      .select({ total: count() })
      .from(matchUpvotes)
      .innerJoin(matchEntries, eq(matchEntries.id, matchUpvotes.entryId))
      .innerJoin(products, eq(products.id, matchEntries.productId))
      .innerJoin(users, eq(users.id, products.userId))
      .where(historyCondition(userId));
    return row?.total ?? 0;
  }

  async list(input: {
    readonly userId: string;
    readonly limit: number;
    readonly before: UpvoteHistoryPosition | undefined;
  }): Promise<readonly UpvoteHistoryRecord[]> {
    const rows = await this.db
      .select({
        upvoteId: matchUpvotes.id,
        matchId: matchUpvotes.matchId,
        entryId: matchUpvotes.entryId,
        productId: products.id,
        matchDate: matchUpvotes.matchDate,
        upvotedAt: matchUpvotes.upvotedAt,
      })
      .from(matchUpvotes)
      .innerJoin(matchEntries, eq(matchEntries.id, matchUpvotes.entryId))
      .innerJoin(products, eq(products.id, matchEntries.productId))
      .innerJoin(users, eq(users.id, products.userId))
      .where(
        and(
          historyCondition(input.userId),
          positionCondition(input.userId, input.before),
        ),
      )
      .orderBy(
        desc(matchUpvotes.matchDate),
        desc(matchUpvotes.upvotedAt),
        desc(matchUpvotes.id),
      )
      .limit(input.limit);
    return rows.map((row) => ({
      ...row,
      matchDate: parseBusinessDate(row.matchDate),
    }));
  }

  async countByDates(
    userId: string,
    dates: readonly BusinessDate[],
  ): Promise<ReadonlyMap<BusinessDate, number>> {
    const unique = [...new Set(dates)];
    const pages = await Promise.all(
      chunk(unique, DATES_PER_STATEMENT).map((page) =>
        this.db
          .select({ matchDate: matchUpvotes.matchDate, total: count() })
          .from(matchUpvotes)
          .innerJoin(matchEntries, eq(matchEntries.id, matchUpvotes.entryId))
          .innerJoin(products, eq(products.id, matchEntries.productId))
          .innerJoin(users, eq(users.id, products.userId))
          .where(
            and(
              historyCondition(userId),
              inArray(matchUpvotes.matchDate, page),
            ),
          )
          .groupBy(matchUpvotes.matchDate),
      ),
    );
    const totals = new Map(
      pages.flat().map((row) => [row.matchDate, row.total]),
    );
    return new Map(unique.map((date) => [date, totals.get(date) ?? 0]));
  }
}
