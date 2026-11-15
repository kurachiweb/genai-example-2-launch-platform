import { env } from 'cloudflare:workers';
import { asc, eq, ne } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';

import { createDatabase } from '../../client.ts';
import { users } from '../identity/users.ts';
import { productCategories } from '../product/product-categories.ts';
import { productLaunches } from '../product/product-launches.ts';
import { products } from '../product/products.ts';
import { matchEntries } from './match-entries.ts';
import { matchEventHandlerRuns } from './match-event-handler-runs.ts';
import { matchEvents } from './match-events.ts';
import { qualifierWins } from './match-queries.ts';
import { matchUpvotes } from './match-upvotes.ts';
import { matches } from './matches.ts';

const OTHER_CATEGORY_ID = '01JD0000000000000000000000';

const OWNER_ID = '01JD0000000000000000000U01';

const MATCH_DATE = '2026-11-20';

const STARTS_AT = new Date(Date.UTC(2026, 10, 19, 15));

const ENDS_AT = new Date(Date.UTC(2026, 10, 20, 14, 40));

const DECIDED_AT = new Date(Date.UTC(2026, 10, 20, 14, 41));

const LAST_UPVOTED_AT = new Date(Date.UTC(2026, 10, 20, 9, 30));

const UNLINKED_AT = new Date(Date.UTC(2026, 11, 20));

const PRODUCT_COUNT = 8;

const productIdOf = (index: number): string =>
  `01JD0000000000000000000P0${String(index)}`;

const launchIdOf = (index: number): string =>
  `01JD0000000000000000000L0${String(index)}`;

const db = createDatabase(env.DB);

type MatchKind = 'qualifier' | 'week';

type EntryResult = 'won' | 'lost' | 'bye' | 'walkover';

interface EntryFixture {
  readonly product: number;
  readonly result: EntryResult | null;
  readonly upvoteCount?: number;
  readonly lastUpvotedAt?: Date;
  readonly unlinked?: boolean;
}

async function insertMatch(
  id: string,
  kind: MatchKind,
  decided: boolean,
  entries: readonly EntryFixture[],
): Promise<void> {
  await db.insert(matches).values({
    id,
    kind,
    matchDate: MATCH_DATE,
    round: kind === 'qualifier' ? null : 1,
    startsAt: STARTS_AT,
    endsAt: ENDS_AT,
    startedAt: STARTS_AT,
    decidedAt: decided ? DECIDED_AT : null,
  });
  await db.insert(matchEntries).values(
    entries.map((entry, index) => ({
      matchId: id,
      slot: index + 1,
      matchKind: kind,
      matchDate: MATCH_DATE,
      launchId: entry.unlinked === true ? null : launchIdOf(entry.product),
      productId: entry.unlinked === true ? null : productIdOf(entry.product),
      ownerUserId: entry.unlinked === true ? null : OWNER_ID,
      upvoteCount: entry.upvoteCount ?? 0,
      lastUpvotedAt: entry.lastUpvotedAt ?? null,
      lastUpvoteSeq: entry.lastUpvotedAt === undefined ? null : 1,
      result: entry.result,
      unlinkedAt: entry.unlinked === true ? UNLINKED_AT : null,
    })),
  );
}

beforeEach(async () => {
  await db.delete(matchEventHandlerRuns);
  await db.delete(matchEvents);
  await db.delete(matchUpvotes);
  await db.delete(matchEntries);
  await db.delete(matches);
  await db.delete(productLaunches);
  await db.delete(products);
  await db
    .delete(productCategories)
    .where(ne(productCategories.id, OTHER_CATEGORY_ID));
  await db.delete(users);
  await db.insert(users).values({
    id: OWNER_ID,
    pseudonymousId: 'pseudonymous-owner',
    email: 'owner@launch.example',
    passwordHash: 'hash',
    nickname: '投稿者',
    handle: 'owner',
    termsAgreedAt: STARTS_AT,
  });
  for (let index = 1; index <= PRODUCT_COUNT; index += 1) {
    await db.insert(products).values({
      id: productIdOf(index),
      userId: OWNER_ID,
      categoryId: OTHER_CATEGORY_ID,
      handle: `product-${String(index)}`,
      name: `名称${String(index)}`,
      tagline: 'タグライン',
      websiteUrl: 'https://product.example/',
      descriptionMarkdown: '説明文',
      logoFileId: `logo-${String(index)}`,
      latestLaunchDate: MATCH_DATE,
    });
    await db.insert(productLaunches).values({
      id: launchIdOf(index),
      productId: productIdOf(index),
      launchDate: MATCH_DATE,
    });
  }

  await insertMatch('01JD0000000000000000000M01', 'qualifier', true, [
    {
      product: 1,
      result: 'won',
      upvoteCount: 5,
      lastUpvotedAt: LAST_UPVOTED_AT,
    },
    {
      product: 2,
      result: 'lost',
      upvoteCount: 3,
      lastUpvotedAt: LAST_UPVOTED_AT,
    },
  ]);
  await insertMatch('01JD0000000000000000000M02', 'qualifier', true, [
    { product: 3, result: 'bye' },
  ]);
  await insertMatch('01JD0000000000000000000M03', 'qualifier', true, [
    {
      product: 4,
      result: 'walkover',
      upvoteCount: 2,
      lastUpvotedAt: LAST_UPVOTED_AT,
    },
    { product: 5, result: 'lost' },
  ]);
  await insertMatch('01JD0000000000000000000M04', 'qualifier', true, [
    { product: 6, result: 'won', upvoteCount: 4, unlinked: true },
    { product: 7, result: 'lost' },
  ]);
  await insertMatch('01JD0000000000000000000M05', 'week', true, [
    { product: 1, result: 'won', upvoteCount: 9 },
    { product: 4, result: 'lost' },
  ]);
  await insertMatch('01JD0000000000000000000M06', 'qualifier', false, [
    { product: 8, result: null, upvoteCount: 1 },
  ]);
});

describe('qualifierWins', () => {
  test('予選で勝利・不戦勝・相手の退会等による勝利の側だけを、集計値と実施日と確定の日時のエポックミリ秒付きで返す', async () => {
    const wins = qualifierWins();

    const rows = await db.select().from(wins).orderBy(asc(wins.launchId));

    expect(rows).toEqual([
      {
        launchId: launchIdOf(1),
        productId: productIdOf(1),
        upvoteCount: 5,
        lastUpvotedAt: LAST_UPVOTED_AT.getTime(),
        matchDate: MATCH_DATE,
        decidedAt: DECIDED_AT.getTime(),
      },
      {
        launchId: launchIdOf(3),
        productId: productIdOf(3),
        upvoteCount: 0,
        lastUpvotedAt: null,
        matchDate: MATCH_DATE,
        decidedAt: DECIDED_AT.getTime(),
      },
      {
        launchId: launchIdOf(4),
        productId: productIdOf(4),
        upvoteCount: 2,
        lastUpvotedAt: LAST_UPVOTED_AT.getTime(),
        matchDate: MATCH_DATE,
        decidedAt: DECIDED_AT.getTime(),
      },
    ]);
  });

  test('他の機能の問い合わせにプロダクトのIDで結合して組み込める', async () => {
    const wins = qualifierWins();

    const rows = await db
      .select({ handle: products.handle, upvoteCount: wins.upvoteCount })
      .from(products)
      .innerJoin(wins, eq(wins.productId, products.id))
      .orderBy(asc(products.handle));

    expect(rows).toEqual([
      { handle: 'product-1', upvoteCount: 5 },
      { handle: 'product-3', upvoteCount: 0 },
      { handle: 'product-4', upvoteCount: 2 },
    ]);
  });
});
