import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  lte,
  sql,
  type SQL,
} from 'drizzle-orm';
import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { users } from '../../../db/schema/identity/users.ts';
import { qualifierWins } from '../../../db/schema/match/match-queries.ts';
import { products } from '../../../db/schema/product/products.ts';
import {
  visibleProducts,
  wonLaunchExists,
} from '../../../db/schema/product/visibility.ts';
import {
  DIRECTORY_PAGE_SIZE,
  type DirectorySort,
} from '../../../common-lib/directory/directory-query-rules.ts';
import { PLATFORM_TYPES } from '../../core/di/identifiers.ts';
import type {
  DirectoryListingInput,
  DirectoryListingPage,
  DirectoryListingQuery,
} from '../../core/directory/ports.ts';
import {
  type BusinessDate,
  parseBusinessDate,
} from '../../core/time/business-time.ts';

const BASE_WIN_RANK = 1;

// 期間の条件を窓関数の前に掛け、期間内で実施日が最大の勝利を各プロダクトの1行目にする。予選は1つのプロダクトに1日1回のため実施日で順位が決まる
function baseWinsOf(
  db: Database,
  from: BusinessDate | undefined,
  to: BusinessDate | undefined,
) {
  const wins = qualifierWins();
  return db.$with('base_wins').as(
    db
      .select({
        productId: wins.productId,
        launchId: wins.launchId,
        matchDate: wins.matchDate,
        upvoteCount: wins.upvoteCount,
        rank: sql<number>`row_number() over (partition by ${wins.productId} order by ${wins.matchDate} desc)`.as(
          'base_win_rank',
        ),
      })
      .from(wins)
      .where(
        and(
          from === undefined ? undefined : gte(wins.matchDate, from),
          to === undefined ? undefined : lte(wins.matchDate, to),
        ),
      ),
  );
}

type BaseWins = ReturnType<typeof baseWinsOf>;

// 同順位は基準勝利の実施日の新しい順、次にプロダクトのIDの降順で決め、ページをまたいで重複・欠落させない
function orderOf(sort: DirectorySort, baseWins: BaseWins): SQL[] {
  const latestFirst = [desc(baseWins.matchDate), desc(products.id)];
  switch (sort) {
    case 'oldest':
      return [asc(baseWins.matchDate), asc(products.id)];
    case 'upvotes':
      return [desc(baseWins.upvoteCount), ...latestFirst];
    case 'newest':
    case 'relevance':
      return latestFirst;
  }
}

@injectable()
export class D1DirectoryListing implements DirectoryListingQuery {
  constructor(@inject(PLATFORM_TYPES.Database) private readonly db: Database) {}

  async page(input: DirectoryListingInput): Promise<DirectoryListingPage> {
    const baseWins = baseWinsOf(this.db, input.from, input.to);
    const joinsBaseWin = and(
      eq(baseWins.productId, products.id),
      eq(baseWins.rank, BASE_WIN_RANK),
    );
    const listed = and(visibleProducts(), wonLaunchExists());
    const [rows, totals] = await this.db.batch([
      this.db
        .with(baseWins)
        .select({
          productId: products.id,
          launchId: baseWins.launchId,
          matchDate: baseWins.matchDate,
          upvoteCount: baseWins.upvoteCount,
        })
        .from(products)
        .innerJoin(users, eq(users.id, products.userId))
        .innerJoin(baseWins, joinsBaseWin)
        .where(listed)
        .orderBy(...orderOf(input.sort, baseWins))
        .limit(DIRECTORY_PAGE_SIZE)
        .offset((input.page - 1) * DIRECTORY_PAGE_SIZE),
      this.db
        .with(baseWins)
        .select({ total: count() })
        .from(products)
        .innerJoin(users, eq(users.id, products.userId))
        .innerJoin(baseWins, joinsBaseWin)
        .where(listed),
    ]);
    return {
      totalCount: totals[0]?.total ?? 0,
      rows: rows.map((row) => ({
        productId: row.productId,
        baseWin: {
          launchId: row.launchId,
          matchDate: parseBusinessDate(row.matchDate),
          upvoteCount: row.upvoteCount,
        },
      })),
    };
  }
}
