import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { Container } from 'inversify';
import { beforeEach, describe, expect, test } from 'vitest';

import { createDatabase, type Database } from '../../../db/client.ts';
import { users } from '../../../db/schema/identity/users.ts';
import { products } from '../../../db/schema/product/products.ts';
import { PLATFORM_TYPES } from '../../core/di/identifiers.ts';
import { DIRECTORY_PLATFORM_TYPES } from '../../core/directory/identifiers.ts';
import type {
  DirectoryListingInput,
  DirectoryListingPage,
  DirectoryListingQuery,
} from '../../core/directory/ports.ts';
import { qualifierWindow } from '../../core/match/match-model.ts';
import {
  parseBusinessDate,
  toBusinessDateTime,
} from '../../core/time/business-time.ts';
import { insertMatch } from '../match/testing/match-fixtures.ts';
import {
  after,
  db,
  insertProduct,
  insertProducts,
  insertUser,
  launchIdOf,
  productIdOf,
  userIdOf,
} from '../product/testing/product-fixtures.ts';
import { D1DirectoryListing } from './d1-directory-listing.ts';
import {
  clearDirectoryTables,
  insertQualifiers,
  qualifierDecidedAt,
  qualifierLaunchOf,
  type QualifierFixture,
  winOf,
} from './testing/directory-listing-fixtures.ts';

const OWNER = 1;
const SUSPENDED_OWNER = 2;
const WITHDRAWN_OWNER = 3;

const LOSER = 99;

const PAGE_SIZE = 20;

const NO_CONDITIONS: DirectoryListingInput = {
  matchExpression: undefined,
  categoryId: undefined,
  from: undefined,
  to: undefined,
  sort: 'newest',
  page: 1,
};

function listingOf(database: Database): DirectoryListingQuery {
  const container = new Container();
  container.bind<Database>(PLATFORM_TYPES.Database).toConstantValue(database);
  container
    .bind<DirectoryListingQuery>(DIRECTORY_PLATFORM_TYPES.DirectoryListingQuery)
    .to(D1DirectoryListing);
  return container.get<DirectoryListingQuery>(
    DIRECTORY_PLATFORM_TYPES.DirectoryListingQuery,
  );
}

const listing = listingOf(db);

function pageOf(
  conditions: Partial<DirectoryListingInput> = {},
): Promise<DirectoryListingPage> {
  return listing.page({ ...NO_CONDITIONS, ...conditions });
}

async function listedIds(
  conditions: Partial<DirectoryListingInput> = {},
): Promise<string[]> {
  const { rows } = await pageOf(conditions);
  return rows.map((row) => row.productId);
}

function idsOf(indexes: readonly number[]): string[] {
  return indexes.map(productIdOf);
}

function winAt(
  match: number,
  product: number,
  date: string,
  upvotes = 1,
): QualifierFixture {
  return winOf(match, {
    product,
    owner: OWNER,
    date,
    upvotes,
    opponent: LOSER,
  });
}

beforeEach(async () => {
  await clearDirectoryTables();
  await insertUser(OWNER);
  await insertProduct(LOSER, OWNER);
});

describe('掲載の条件', () => {
  const LISTED_WIN = 1;
  const LOST_ONLY = 2;
  const BOTH_LOST_FIRST = 3;
  const BOTH_LOST_SECOND = 4;
  const TOURNAMENT_ONLY = 5;
  const UNDECIDED = 6;
  const HIDDEN = 7;
  const DELETED = 8;
  const BY_SUSPENDED = 9;
  const BY_WITHDRAWN = 10;
  const LISTED_BYE = 11;
  const LISTED_WALKOVER = 12;

  beforeEach(async () => {
    await insertUser(SUSPENDED_OWNER, {
      status: 'suspended',
      suspendedAt: after(1),
    });
    await insertUser(WITHDRAWN_OWNER, { deletedAt: after(2) });
    await insertProducts(
      [
        LISTED_WIN,
        LOST_ONLY,
        BOTH_LOST_FIRST,
        BOTH_LOST_SECOND,
        TOURNAMENT_ONLY,
        UNDECIDED,
        LISTED_BYE,
        LISTED_WALKOVER,
      ],
      OWNER,
    );
    await insertProduct(HIDDEN, OWNER, { hiddenAt: after(3) });
    await insertProduct(DELETED, OWNER, { deletedAt: after(4) });
    await insertProduct(BY_SUSPENDED, SUSPENDED_OWNER);
    await insertProduct(BY_WITHDRAWN, WITHDRAWN_OWNER);
    await insertQualifiers([
      {
        match: 1,
        date: '2026-11-20',
        sides: [
          { product: LISTED_WIN, owner: OWNER, result: 'won', upvotes: 4 },
          { product: LOST_ONLY, owner: OWNER, result: 'lost', upvotes: 2 },
        ],
      },
      {
        match: 2,
        date: '2026-11-19',
        decision: 'both_forfeited',
        sides: [
          { product: BOTH_LOST_FIRST, owner: OWNER, result: 'lost' },
          { product: BOTH_LOST_SECOND, owner: OWNER, result: 'lost' },
        ],
      },
      {
        match: 3,
        date: '2026-11-18',
        decision: 'walkover',
        sides: [
          { product: LISTED_WALKOVER, owner: OWNER, result: 'walkover' },
          { product: TOURNAMENT_ONLY, owner: OWNER, result: 'lost' },
        ],
      },
      {
        match: 4,
        date: '2026-11-21',
        sides: [{ product: UNDECIDED, owner: OWNER, result: null }],
      },
      {
        match: 5,
        date: '2026-11-17',
        decision: 'bye',
        sides: [{ product: LISTED_BYE, owner: OWNER, result: 'bye' }],
      },
      winAt(6, HIDDEN, '2026-11-16'),
      winAt(7, DELETED, '2026-11-15'),
      winOf(8, {
        product: BY_SUSPENDED,
        owner: SUSPENDED_OWNER,
        date: '2026-11-14',
        opponent: LOSER,
      }),
      winOf(9, {
        product: BY_WITHDRAWN,
        owner: WITHDRAWN_OWNER,
        date: '2026-11-13',
        opponent: LOSER,
      }),
    ]);
    await insertMatch({
      index: 10,
      columns: {
        kind: 'week',
        round: 1,
        matchDate: '2026-11-22',
        startedAt: qualifierWindow(parseBusinessDate('2026-11-22')).startsAt,
        startsAt: qualifierWindow(parseBusinessDate('2026-11-22')).startsAt,
        endsAt: qualifierWindow(parseBusinessDate('2026-11-22')).endsAt,
        decidedAt: qualifierDecidedAt('2026-11-22'),
        decision: 'votes',
      },
      entries: [
        {
          index: 901,
          launch: qualifierLaunchOf(3, 1),
          product: TOURNAMENT_ONLY,
          owner: OWNER,
          columns: { upvoteCount: 9, result: 'won' },
        },
        {
          index: 902,
          launch: qualifierLaunchOf(1),
          product: LISTED_WIN,
          owner: OWNER,
          columns: { upvoteCount: 3, result: 'lost' },
        },
      ],
    });
  });

  test('予選の勝利・相手の退会等による勝利・不戦勝のある公開中のプロダクトだけを掲載し、敗北・両者敗北・未確定・トーナメントの勝利だけのプロダクトと、非公開・論理削除・停止中や退会済みの投稿者のプロダクトを除く', async () => {
    const page = await pageOf();

    expect(page.rows.map((row) => row.productId)).toEqual(
      idsOf([LISTED_WIN, LISTED_WALKOVER, LISTED_BYE]),
    );
    expect(page.totalCount).toBe(3);
  });

  test('投稿者の停止の解除と非公開の解除で再び掲載する', async () => {
    await db
      .update(users)
      .set({ status: 'active', suspendedAt: null })
      .where(eq(users.id, userIdOf(SUSPENDED_OWNER)));
    await db
      .update(products)
      .set({ hiddenAt: null })
      .where(eq(products.id, productIdOf(HIDDEN)));

    const page = await pageOf();

    expect(page.rows.map((row) => row.productId)).toEqual(
      idsOf([LISTED_WIN, LISTED_WALKOVER, LISTED_BYE, HIDDEN, BY_SUSPENDED]),
    );
    expect(page.totalCount).toBe(5);
  });
});

describe('基準勝利', () => {
  const TWICE = 1;

  beforeEach(async () => {
    await insertProduct(TWICE, OWNER);
    await insertQualifiers([
      winAt(1, TWICE, '2026-11-10', 5),
      winAt(2, TWICE, '2026-11-20', 8),
    ]);
  });

  test('2回勝利したプロダクトを1項目とし、直近の勝利のローンチ・実施日・自身のUpvote数を基準勝利にする', async () => {
    const page = await pageOf();

    expect(page).toEqual<DirectoryListingPage>({
      totalCount: 1,
      rows: [
        {
          productId: productIdOf(TWICE),
          baseWin: {
            launchId: launchIdOf(qualifierLaunchOf(2)),
            matchDate: parseBusinessDate('2026-11-20'),
            upvoteCount: 8,
          },
        },
      ],
    });
  });
});

describe('期間', () => {
  const ON_FROM = 1;
  const ON_TO = 2;
  const BEFORE_ONLY = 3;
  const AFTER_ONLY = 4;
  const INSIDE_AND_AFTER = 5;

  beforeEach(async () => {
    await insertProducts(
      [ON_FROM, ON_TO, BEFORE_ONLY, AFTER_ONLY, INSIDE_AND_AFTER],
      OWNER,
    );
    await insertQualifiers([
      winAt(1, ON_FROM, '2026-11-12'),
      winAt(2, ON_TO, '2026-11-18'),
      winAt(3, BEFORE_ONLY, '2026-11-11'),
      winAt(4, AFTER_ONLY, '2026-11-19'),
      winAt(5, INSIDE_AND_AFTER, '2026-11-13', 3),
      winAt(6, INSIDE_AND_AFTER, '2026-11-20', 7),
    ]);
  });

  test('開始日・終了日と同じ日の勝利を含め、期間外の勝利だけのプロダクトを除き、期間内の古い勝利を基準勝利にする', async () => {
    const page = await pageOf({
      from: parseBusinessDate('2026-11-12'),
      to: parseBusinessDate('2026-11-18'),
    });

    expect(page.rows.map((row) => row.productId)).toEqual(
      idsOf([ON_TO, INSIDE_AND_AFTER, ON_FROM]),
    );
    expect(page.rows[1]?.baseWin).toEqual({
      launchId: launchIdOf(qualifierLaunchOf(5)),
      matchDate: parseBusinessDate('2026-11-13'),
      upvoteCount: 3,
    });
    expect(page.totalCount).toBe(3);
  });

  test('開始日だけの期間は開始日以降の勝利で、終了日だけの期間は終了日以前の勝利で絞り込む', async () => {
    expect(await listedIds({ from: parseBusinessDate('2026-11-19') })).toEqual(
      idsOf([INSIDE_AND_AFTER, AFTER_ONLY]),
    );
    expect(await listedIds({ to: parseBusinessDate('2026-11-11') })).toEqual(
      idsOf([BEFORE_ONLY]),
    );
  });

  test('期間が無ければ直近の勝利を基準勝利にする', async () => {
    const { rows } = await pageOf();

    expect(rows[0]).toEqual({
      productId: productIdOf(INSIDE_AND_AFTER),
      baseWin: {
        launchId: launchIdOf(qualifierLaunchOf(6)),
        matchDate: parseBusinessDate('2026-11-20'),
        upvoteCount: 7,
      },
    });
  });
});

describe('基準時刻の日付の切り替わり', () => {
  const BEFORE_MIDNIGHT = 1;
  const AFTER_MIDNIGHT = 2;

  beforeEach(async () => {
    await insertProducts([BEFORE_MIDNIGHT, AFTER_MIDNIGHT], OWNER);
    await insertQualifiers([
      winAt(1, BEFORE_MIDNIGHT, '2026-11-19'),
      winAt(2, AFTER_MIDNIGHT, '2026-11-20'),
    ]);
  });

  test('基準時刻の0時の直前に確定した勝利は前日、0時に始まった勝利は当日の実施日として期間を判定する', async () => {
    const decidedBefore = qualifierDecidedAt('2026-11-19');
    const startedAfter = qualifierWindow(
      parseBusinessDate('2026-11-20'),
    ).startsAt;
    expect(toBusinessDateTime(decidedBefore)).toMatchObject({
      date: '2026-11-19',
      hour: 23,
    });
    expect(toBusinessDateTime(startedAfter)).toMatchObject({
      date: '2026-11-20',
      hour: 0,
      minute: 0,
    });
    expect(decidedBefore.toISOString().slice(0, 10)).toBe(
      startedAfter.toISOString().slice(0, 10),
    );

    const previousDay = await pageOf({
      from: parseBusinessDate('2026-11-19'),
      to: parseBusinessDate('2026-11-19'),
    });
    const sameDay = await pageOf({
      from: parseBusinessDate('2026-11-20'),
      to: parseBusinessDate('2026-11-20'),
    });

    expect(previousDay.rows.map((row) => row.productId)).toEqual(
      idsOf([BEFORE_MIDNIGHT]),
    );
    expect(previousDay.rows[0]?.baseWin.matchDate).toBe('2026-11-19');
    expect(sameDay.rows.map((row) => row.productId)).toEqual(
      idsOf([AFTER_MIDNIGHT]),
    );
    expect(sameDay.rows[0]?.baseWin.matchDate).toBe('2026-11-20');
  });
});

describe('並び順', () => {
  const LATE_FEW = 1;
  const EARLY_MANY = 2;
  const LATE_MANY = 3;
  const EARLY_FEW = 4;
  const LATE_FEW_HIGHER_ID = 5;

  beforeEach(async () => {
    await insertProducts(
      [LATE_FEW, EARLY_MANY, LATE_MANY, EARLY_FEW, LATE_FEW_HIGHER_ID],
      OWNER,
    );
    await insertQualifiers([
      winAt(1, LATE_FEW, '2026-11-20', 5),
      winAt(2, EARLY_MANY, '2026-11-18', 9),
      winAt(3, LATE_MANY, '2026-11-20', 9),
      winAt(4, EARLY_FEW, '2026-11-18', 5),
      winAt(5, LATE_FEW_HIGHER_ID, '2026-11-20', 5),
    ]);
  });

  test('ローンチ日が新しい順は基準勝利の実施日の新しい順、同じ日はプロダクトのIDの降順に並べる', async () => {
    expect(await listedIds({ sort: 'newest' })).toEqual(
      idsOf([LATE_FEW_HIGHER_ID, LATE_MANY, LATE_FEW, EARLY_FEW, EARLY_MANY]),
    );
  });

  test('ローンチ日が古い順は基準勝利の実施日の古い順、同じ日はプロダクトのIDの昇順に並べる', async () => {
    expect(await listedIds({ sort: 'oldest' })).toEqual(
      idsOf([EARLY_MANY, EARLY_FEW, LATE_FEW, LATE_MANY, LATE_FEW_HIGHER_ID]),
    );
  });

  test('Upvote数が多い順は基準勝利の自身のUpvote数の多い順、同数は実施日の新しい順、次にプロダクトのIDの降順に並べる', async () => {
    expect(await listedIds({ sort: 'upvotes' })).toEqual(
      idsOf([LATE_MANY, EARLY_MANY, LATE_FEW_HIGHER_ID, LATE_FEW, EARLY_FEW]),
    );
  });

  test('関連度の値が無い場合は同順位の決まった順(実施日の新しい順、次にプロダクトのIDの降順)に並べる', async () => {
    expect(await listedIds({ sort: 'relevance' })).toEqual(
      idsOf([LATE_FEW_HIGHER_ID, LATE_MANY, LATE_FEW, EARLY_FEW, EARLY_MANY]),
    );
  });
});

describe('ページ分け', () => {
  const LISTED_COUNT = 21;
  const indexes = Array.from({ length: LISTED_COUNT }, (_, index) => index + 1);

  beforeEach(async () => {
    await insertProducts(indexes, OWNER);
    await insertQualifiers(
      indexes.map((index) => winAt(index, index, '2026-11-20')),
    );
  });

  test('1ページ目は同順位の決まった順の20件目までを、2ページ目は21件目を、どちらも総件数付きで返す', async () => {
    const descending = indexes.toReversed();

    const first = await pageOf({ page: 1 });
    const second = await pageOf({ page: 2 });

    expect(first.rows.map((row) => row.productId)).toEqual(
      idsOf(descending.slice(0, PAGE_SIZE)),
    );
    expect(first.totalCount).toBe(LISTED_COUNT);
    expect(second.rows.map((row) => row.productId)).toEqual(
      idsOf(descending.slice(PAGE_SIZE)),
    );
    expect(second.totalCount).toBe(LISTED_COUNT);
  });

  test('総ページ数を超えるページは空の一覧と総件数を返す', async () => {
    expect(await pageOf({ page: 3 })).toEqual<DirectoryListingPage>({
      totalCount: LISTED_COUNT,
      rows: [],
    });
  });

  test('一覧と総件数を1回の一括の読み取りで読む', async () => {
    const preparedCount = { value: 0 };
    const batchSizes: number[] = [];
    const d1 = env.DB;
    const recording = listingOf(
      createDatabase({
        prepare: (query) => {
          preparedCount.value += 1;
          return d1.prepare(query);
        },
        batch: (statements) => {
          batchSizes.push(statements.length);
          return d1.batch(statements);
        },
        exec: d1.exec.bind(d1),
        withSession: d1.withSession.bind(d1),
        // D1Databaseの型が非推奨のdumpも必須にするため、偽物でも渡す
        // eslint-disable-next-line @typescript-eslint/no-deprecated
        dump: d1.dump.bind(d1),
      }),
    );

    const page = await recording.page({ ...NO_CONDITIONS, page: 2 });

    expect(page.totalCount).toBe(LISTED_COUNT);
    expect(batchSizes).toEqual([2]);
    expect(preparedCount.value).toBe(2);
  });
});
