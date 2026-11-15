import { beforeEach, describe, expect, test } from 'vitest';

import type {
  MatchExportRecord,
  UpvoteExportRecord,
} from '../../core/match/ports.ts';
import { parseBusinessDate } from '../../core/time/business-time.ts';
import {
  createRecordingDatabase,
  expectSplitWithinBindLimit,
} from '../identity/testing/identity-store-fixtures.ts';
import {
  db,
  insertLaunches,
  launchIdOf,
  productIdOf,
  userIdOf,
} from '../product/testing/product-fixtures.ts';
import { D1MatchExport, D1UpvoteExport } from './d1-match-export.ts';
import {
  DECIDED_AT,
  ENDS_AT,
  minutesAfterStart,
  seedDirectoryOwners,
  settledQualifier,
  STARTS_AT,
} from './testing/directory-fixtures.ts';
import {
  insertMatches,
  insertUpvotes,
  MATCH_DATE,
  matchIdOf,
} from './testing/match-fixtures.ts';

const BULK_COUNT = 95;

const DAY = 86_400_000;

const WEEK_DATE = '2026-11-23';

const matchExport = new D1MatchExport(db);

const upvoteExport = new D1UpvoteExport(db);

function daysLater(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY);
}

beforeEach(seedDirectoryOwners);

describe('MatchExport.listForLaunches', () => {
  test('確定した予選の両方のローンチに、自分と相手の確定のUpvote数・自分の最終Upvote時間・結果を返す', async () => {
    await insertMatches([settledQualifier(1)]);

    const found = await matchExport.listForLaunches([
      launchIdOf(1),
      launchIdOf(3),
    ]);

    expect(found.get(launchIdOf(1))).toEqual<MatchExportRecord[]>([
      {
        matchId: matchIdOf(1),
        launchId: launchIdOf(1),
        kind: 'qualifier',
        round: null,
        date: parseBusinessDate(MATCH_DATE),
        upvoteCount: 12,
        opponentUpvoteCount: 9,
        lastUpvotedAt: minutesAfterStart(842),
        result: 'won',
      },
    ]);
    expect(found.get(launchIdOf(3))).toEqual<MatchExportRecord[]>([
      {
        matchId: matchIdOf(1),
        launchId: launchIdOf(3),
        kind: 'qualifier',
        round: null,
        date: parseBusinessDate(MATCH_DATE),
        upvoteCount: 9,
        opponentUpvoteCount: 12,
        lastUpvotedAt: minutesAfterStart(1110),
        result: 'lost',
      },
    ]);
  });

  test('ローンチのマッチを、トーナメントのラウンド付きで実施日の古い順に返し、不戦勝の相手のUpvote数を0にする', async () => {
    await insertMatches([
      {
        index: 2,
        columns: {
          kind: 'week',
          round: 1,
          stage: 'quarterfinal',
          matchDate: WEEK_DATE,
          startsAt: daysLater(STARTS_AT, 3),
          endsAt: daysLater(ENDS_AT, 3),
          startedAt: daysLater(STARTS_AT, 3),
          decidedAt: daysLater(STARTS_AT, 3),
          decision: 'bye',
        },
        entries: [
          {
            index: 21,
            launch: 1,
            product: 1,
            owner: 1,
            columns: { result: 'bye' },
          },
        ],
      },
      settledQualifier(1),
    ]);

    const found = await matchExport.listForLaunches([launchIdOf(1)]);

    const records = found.get(launchIdOf(1));

    expect(records?.map((record) => record.matchId)).toEqual([
      matchIdOf(1),
      matchIdOf(2),
    ]);
    expect(records?.[1]).toEqual<MatchExportRecord>({
      matchId: matchIdOf(2),
      launchId: launchIdOf(1),
      kind: 'week',
      round: 1,
      date: parseBusinessDate(WEEK_DATE),
      upvoteCount: 0,
      opponentUpvoteCount: 0,
      lastUpvotedAt: null,
      result: 'bye',
    });
  });

  test('結果が確定していないマッチは、照会の時点のUpvote数と結果のnullを返す', async () => {
    await insertMatches([
      {
        index: 1,
        columns: { startedAt: STARTS_AT },
        entries: [
          {
            index: 11,
            launch: 1,
            product: 1,
            owner: 1,
            columns: { upvoteCount: 3, lastUpvotedAt: minutesAfterStart(10) },
          },
          {
            index: 12,
            launch: 3,
            product: 3,
            owner: 2,
            columns: { upvoteCount: 5, lastUpvotedAt: minutesAfterStart(20) },
          },
        ],
      },
    ]);

    const found = await matchExport.listForLaunches([launchIdOf(1)]);

    expect(found.get(launchIdOf(1))).toEqual<MatchExportRecord[]>([
      {
        matchId: matchIdOf(1),
        launchId: launchIdOf(1),
        kind: 'qualifier',
        round: null,
        date: parseBusinessDate(MATCH_DATE),
        upvoteCount: 3,
        opponentUpvoteCount: 5,
        lastUpvotedAt: minutesAfterStart(10),
        result: null,
      },
    ]);
  });

  test('相手の側の紐付けを解除していても相手のUpvote数を返し、指定していないローンチとマッチの無いローンチを含めない', async () => {
    await insertMatches([
      {
        index: 1,
        columns: {
          startedAt: STARTS_AT,
          decidedAt: DECIDED_AT,
          decision: 'votes',
        },
        entries: [
          {
            index: 11,
            launch: 1,
            product: 1,
            owner: 1,
            columns: {
              upvoteCount: 4,
              lastUpvotedAt: minutesAfterStart(30),
              result: 'won',
            },
          },
          {
            index: 12,
            launch: null,
            product: null,
            owner: null,
            columns: {
              upvoteCount: 2,
              lastUpvotedAt: minutesAfterStart(40),
              result: 'lost',
              unlinkedAt: DECIDED_AT,
            },
          },
        ],
      },
      {
        ...settledQualifier(2),
        columns: {
          ...settledQualifier(2).columns,
          kind: 'week',
          round: 1,
          matchDate: WEEK_DATE,
          startsAt: daysLater(STARTS_AT, 3),
          endsAt: daysLater(ENDS_AT, 3),
        },
      },
    ]);

    const found = await matchExport.listForLaunches([
      launchIdOf(1),
      launchIdOf(4),
    ]);

    expect([...found.keys()]).toEqual([launchIdOf(1)]);
    expect(
      found
        .get(launchIdOf(1))
        ?.map((record) => [record.matchId, record.opponentUpvoteCount]),
    ).toEqual([
      [matchIdOf(1), 2],
      [matchIdOf(2), 9],
    ]);
  });

  test('ローンチの指定が空なら問い合わせずに空を返す', async () => {
    const recording = createRecordingDatabase();

    const found = await new D1MatchExport(recording.database).listForLaunches(
      [],
    );

    expect(found.size).toBe(0);
    expect(recording.placeholderCounts).toEqual([]);
  });

  test('90件を超えるローンチのIDはバインド変数の上限に収まるよう分けて読み、重複を除く', async () => {
    await insertLaunches(
      Array.from({ length: BULK_COUNT }, (_, offset) => ({
        index: 100 + offset,
        productIndex: 4,
        columns: { outcome: 'lost', decidedAt: DECIDED_AT },
      })),
    );
    await insertMatches(
      Array.from({ length: BULK_COUNT }, (_, offset) => ({
        index: 100 + offset,
        entries: [
          { index: 100 + offset, launch: 100 + offset, product: 4, owner: 2 },
        ],
      })),
    );
    const ids = Array.from({ length: BULK_COUNT }, (_, offset) =>
      launchIdOf(100 + offset),
    );
    const recording = createRecordingDatabase();

    const found = await new D1MatchExport(recording.database).listForLaunches([
      ...ids,
      ...ids,
    ]);

    expect(found.size).toBe(BULK_COUNT);
    for (const id of ids) {
      expect(found.get(id)).toHaveLength(1);
    }
    expectSplitWithinBindLimit(recording.placeholderCounts);
  });
});

describe('UpvoteExport.listByUser', () => {
  beforeEach(async () => {
    await insertMatches([
      settledQualifier(1),
      {
        index: 2,
        columns: {
          kind: 'week',
          round: 2,
          stage: 'semifinal',
          matchDate: WEEK_DATE,
          startsAt: daysLater(STARTS_AT, 3),
          endsAt: daysLater(ENDS_AT, 3),
        },
        entries: [
          { index: 21, launch: 2, product: 2, owner: 1 },
          {
            index: 22,
            launch: null,
            product: null,
            owner: null,
            columns: { unlinkedAt: DECIDED_AT },
          },
        ],
      },
      {
        index: 3,
        entries: [
          { index: 31, launch: 4, product: 4, owner: 2 },
          { index: 32, launch: null, product: null, owner: null },
        ],
      },
    ]);
  });

  test('有効なUpvoteを、マッチ・種別・実施日・プロダクト・Upvoteの日時付きでUpvoteの日時の古い順に返し、紐付けを解除した側のプロダクトをnullにする', async () => {
    await insertUpvotes([
      {
        index: 1,
        match: 2,
        entry: 22,
        user: 1,
        upvotedAt: daysLater(minutesAfterStart(5), 3),
        columns: { matchDate: WEEK_DATE },
      },
      {
        index: 2,
        match: 1,
        entry: 12,
        user: 1,
        upvotedAt: minutesAfterStart(60),
      },
      {
        index: 3,
        match: 3,
        entry: 31,
        user: 2,
        upvotedAt: minutesAfterStart(1),
      },
    ]);

    const records = await upvoteExport.listByUser(userIdOf(1));

    expect(records).toEqual<UpvoteExportRecord[]>([
      {
        matchId: matchIdOf(1),
        matchKind: 'qualifier',
        matchDate: parseBusinessDate(MATCH_DATE),
        productId: productIdOf(3),
        upvotedAt: minutesAfterStart(60),
      },
      {
        matchId: matchIdOf(2),
        matchKind: 'week',
        matchDate: parseBusinessDate(WEEK_DATE),
        productId: null,
        upvotedAt: daysLater(minutesAfterStart(5), 3),
      },
    ]);
  });

  test('取り消したUpvoteを含めず、同じ日時のUpvoteはIDの順に返す', async () => {
    await insertUpvotes([
      {
        index: 1,
        match: 1,
        entry: 11,
        user: 1,
        upvotedAt: minutesAfterStart(10),
        columns: { deletedAt: minutesAfterStart(11) },
      },
      {
        index: 3,
        match: 3,
        entry: 31,
        user: 1,
        upvotedAt: minutesAfterStart(20),
      },
      {
        index: 2,
        match: 1,
        entry: 12,
        user: 1,
        upvotedAt: minutesAfterStart(20),
      },
    ]);

    const records = await upvoteExport.listByUser(userIdOf(1));

    expect(records.map((record) => [record.matchId, record.productId])).toEqual(
      [
        [matchIdOf(1), productIdOf(3)],
        [matchIdOf(3), productIdOf(4)],
      ],
    );
  });

  test('Upvoteの無い利用者には空を返す', async () => {
    const records = await upvoteExport.listByUser(userIdOf(2));

    expect(records).toEqual([]);
  });
});
