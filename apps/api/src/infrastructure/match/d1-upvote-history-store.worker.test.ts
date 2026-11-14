import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';

import { matchUpvotes } from '../../../db/schema/match/match-upvotes.ts';
import {
  type BusinessDate,
  parseBusinessDate,
} from '../../../lib/core/time/business-time.ts';
import {
  createRecordingDatabase,
  expectSplitWithinBindLimit,
} from '../../../lib/workers/identity/testing/identity-store-fixtures.ts';
import {
  entryIdOf,
  insertMatches,
  insertUpvotes,
  type MatchFixture,
  matchIdOf,
  upvoteIdOf,
} from '../../../lib/workers/match/testing/match-fixtures.ts';
import {
  db,
  insertProduct,
  productIdOf,
  T0,
  userIdOf,
} from '../../../lib/workers/product/testing/product-fixtures.ts';
import type {
  UpvoteHistoryPosition,
  UpvoteHistoryRecord,
} from '../../application/match/ports.ts';
import { D1UpvoteHistoryStore } from './d1-upvote-history-store.ts';
import {
  OTHER_VOTER,
  OWNER_A,
  OWNER_B,
  secondsAfterStart,
  seedUpvoteParticipants,
  SUSPENDED,
  VOTER,
  WITHDRAWN,
} from './testing/upvote-store-fixtures.ts';

const BULK_DATE_COUNT = 95;

const store = new D1UpvoteHistoryStore(db);

const OLDEST_DATE = '2026-11-18';

const MIDDLE_DATE = '2026-11-19';

const NEWEST_DATE = '2026-11-20';

const dateOf = (value: string): BusinessDate => parseBusinessDate(value);

// 1つのプロダクトの側と、投稿者Bのプロダクト3の側を持つ実施日dateのマッチ。productがnullなら紐付けを解除した側
function matchWith(
  index: number,
  date: string,
  product: number | null = 1,
  owner: number | null = OWNER_A,
): MatchFixture {
  return {
    index,
    columns: { matchDate: date },
    entries: [
      { index: index * 10 + 1, launch: null, product, owner },
      { index: index * 10 + 2, launch: null, product: 3, owner: OWNER_B },
    ],
  };
}

function upvoteOn(
  index: number,
  date: string,
  seconds: number,
  user = VOTER,
  columns: { readonly deletedAt?: Date } = {},
) {
  return {
    index,
    match: index,
    entry: index * 10 + 1,
    user,
    upvotedAt: secondsAfterStart(seconds),
    columns: { matchDate: date, ...columns },
  };
}

const idsOf = (rows: readonly UpvoteHistoryRecord[]): string[] =>
  rows.map((row) => row.upvoteId);

async function readAll(limit: number): Promise<string[][]> {
  const pages: string[][] = [];
  let before: UpvoteHistoryPosition | undefined;
  for (;;) {
    const rows = await store.list({ userId: userIdOf(VOTER), limit, before });
    if (rows.length === 0) {
      return pages;
    }
    pages.push(idsOf(rows));
    const last = rows.at(-1);
    before =
      last === undefined
        ? undefined
        : { matchDate: last.matchDate, matchId: last.matchId };
  }
}

beforeEach(seedUpvoteParticipants);

describe('D1UpvoteHistoryStore: 並びと件数', () => {
  beforeEach(async () => {
    await insertMatches([
      matchWith(1, OLDEST_DATE),
      matchWith(2, OLDEST_DATE),
      matchWith(3, MIDDLE_DATE),
      matchWith(4, NEWEST_DATE),
      matchWith(5, NEWEST_DATE),
      matchWith(6, NEWEST_DATE),
    ]);
    await insertUpvotes([
      upvoteOn(1, OLDEST_DATE, 10),
      upvoteOn(2, OLDEST_DATE, 20),
      upvoteOn(3, MIDDLE_DATE, 5),
      upvoteOn(4, NEWEST_DATE, 30),
      upvoteOn(5, NEWEST_DATE, 30),
      upvoteOn(6, NEWEST_DATE, 40, OTHER_VOTER),
    ]);
  });

  test('利用者の有効なUpvoteを実施日・Upvoteの日時・IDの新しい順に、位置より後からlimit件ずつ返す', async () => {
    expect(await readAll(2)).toEqual([
      [upvoteIdOf(5), upvoteIdOf(4)],
      [upvoteIdOf(3), upvoteIdOf(2)],
      [upvoteIdOf(1)],
    ]);
  });

  test('limitが1でも、同じ実施日・同じ日時のUpvoteをIDの順に1件ずつ漏れなく重複なく返す', async () => {
    expect(await readAll(1)).toEqual([
      [upvoteIdOf(5)],
      [upvoteIdOf(4)],
      [upvoteIdOf(3)],
      [upvoteIdOf(2)],
      [upvoteIdOf(1)],
    ]);
  });

  test('位置のマッチのUpvoteが読み込みの間に取り消されていれば、その実施日の残りを飛ばして前の実施日から返す', async () => {
    await db
      .update(matchUpvotes)
      .set({ deletedAt: secondsAfterStart(60) })
      .where(eq(matchUpvotes.id, upvoteIdOf(5)));

    const rows = await store.list({
      userId: userIdOf(VOTER),
      limit: 20,
      before: { matchDate: dateOf(NEWEST_DATE), matchId: matchIdOf(5) },
    });

    expect(idsOf(rows)).toEqual([upvoteIdOf(3), upvoteIdOf(2), upvoteIdOf(1)]);
  });

  test.each([
    ['他の利用者のUpvoteしか無いマッチ', NEWEST_DATE, 6, [3, 2, 1]],
    ['実施日の違うマッチ', MIDDLE_DATE, 5, [2, 1]],
    ['存在しないマッチ', NEWEST_DATE, 99, [3, 2, 1]],
  ] as const)(
    '位置が%sを指すときは、位置の実施日より前の実施日から返す',
    async (_label, date, match, expected) => {
      const rows = await store.list({
        userId: userIdOf(VOTER),
        limit: 20,
        before: { matchDate: dateOf(date), matchId: matchIdOf(match) },
      });

      expect(idsOf(rows)).toEqual(expected.map(upvoteIdOf));
    },
  );

  test('各行にUpvote・マッチ・側・プロダクトのIDと実施日とUpvoteの日時を返す', async () => {
    const rows = await store.list({
      userId: userIdOf(VOTER),
      limit: 1,
      before: undefined,
    });

    expect(rows).toEqual([
      {
        upvoteId: upvoteIdOf(5),
        matchId: matchIdOf(5),
        entryId: entryIdOf(51),
        productId: productIdOf(1),
        matchDate: dateOf(NEWEST_DATE),
        upvotedAt: secondsAfterStart(30),
      },
    ]);
  });

  test('件数は利用者の有効なUpvoteの総数で、他の利用者のUpvoteを数えない', async () => {
    expect(await store.count(userIdOf(VOTER))).toBe(5);
    expect(await store.count(userIdOf(OTHER_VOTER))).toBe(1);
  });

  test('実施日ごとの件数を指定した日だけ返し、対象の無い日は0にする', async () => {
    const totals = await store.countByDates(userIdOf(VOTER), [
      dateOf(NEWEST_DATE),
      dateOf(OLDEST_DATE),
      dateOf('2026-11-17'),
    ]);

    expect(totals).toEqual(
      new Map([
        [dateOf(NEWEST_DATE), 2],
        [dateOf(OLDEST_DATE), 2],
        [dateOf('2026-11-17'), 0],
      ]),
    );
  });

  test('実施日を指定しなければ問い合わせずに空で返す', async () => {
    const recording = createRecordingDatabase();

    const totals = await new D1UpvoteHistoryStore(
      recording.database,
    ).countByDates(userIdOf(VOTER), []);

    expect(totals.size).toBe(0);
    expect(recording.placeholderCounts).toEqual([]);
  });

  test('バインド変数の上限を超える実施日の指定を分けて数える', async () => {
    const dates = Array.from({ length: BULK_DATE_COUNT }, (_, offset) =>
      dateOf(
        new Date(Date.UTC(2026, 0, 1 + offset)).toISOString().slice(0, 10),
      ),
    );
    const recording = createRecordingDatabase();

    const totals = await new D1UpvoteHistoryStore(
      recording.database,
    ).countByDates(userIdOf(VOTER), [...dates, dateOf(NEWEST_DATE)]);

    expect(totals.size).toBe(BULK_DATE_COUNT + 1);
    expect(totals.get(dateOf(NEWEST_DATE))).toBe(2);
    expect(totals.get(dates[0] ?? dateOf(NEWEST_DATE))).toBe(0);
    expectSplitWithinBindLimit(recording.placeholderCounts);
  });
});

describe('D1UpvoteHistoryStore: 除外', () => {
  // 1: 可視 / 2: 非公開化 / 3: 論理削除 / 4: 停止中の投稿者 / 5: 退会済みの投稿者 / 6: 紐付けの解除 / 7: 論理削除したUpvote
  beforeEach(async () => {
    await insertProduct(5, OWNER_A, { handle: 'hidden5', hiddenAt: T0 });
    await insertProduct(6, OWNER_A, { handle: 'deleted6', deletedAt: T0 });
    await insertProduct(7, SUSPENDED, { handle: 'suspended7' });
    await insertProduct(8, WITHDRAWN, { handle: 'withdrawn8' });
    await insertMatches([
      matchWith(1, NEWEST_DATE),
      matchWith(2, NEWEST_DATE, 5),
      matchWith(3, NEWEST_DATE, 6),
      matchWith(4, NEWEST_DATE, 7, SUSPENDED),
      matchWith(5, NEWEST_DATE, 8, WITHDRAWN),
      matchWith(6, NEWEST_DATE, null, null),
      matchWith(7, NEWEST_DATE),
    ]);
    await insertUpvotes([
      ...[1, 2, 3, 4, 5, 6].map((index) => upvoteOn(index, NEWEST_DATE, index)),
      upvoteOn(7, NEWEST_DATE, 7, VOTER, { deletedAt: secondsAfterStart(8) }),
    ]);
  });

  test('非公開化・論理削除・停止中や退会済みの投稿者・紐付けの解除のプロダクトと論理削除したUpvoteを一覧から除く', async () => {
    const rows = await store.list({
      userId: userIdOf(VOTER),
      limit: 20,
      before: undefined,
    });

    expect(idsOf(rows)).toEqual([upvoteIdOf(1)]);
  });

  test('件数と実施日ごとの件数も同じ条件で数える', async () => {
    expect(await store.count(userIdOf(VOTER))).toBe(1);
    expect(
      await store.countByDates(userIdOf(VOTER), [dateOf(NEWEST_DATE)]),
    ).toEqual(new Map([[dateOf(NEWEST_DATE), 1]]));
  });
});
