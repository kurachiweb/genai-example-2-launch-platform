import { beforeEach, describe, expect, test } from 'vitest';

import type { MatchRecord } from '../../core/match/ports.ts';
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
import { D1MatchDirectory } from './d1-match-directory.ts';
import {
  AFTER_DECISION,
  DECIDED_AT,
  DURING_MATCH,
  ENDS_AT,
  minutesAfterStart,
  seedDirectoryOwners,
  settledQualifier,
  STARTS_AT,
} from './testing/directory-fixtures.ts';
import {
  entryIdOf,
  insertMatch,
  insertMatches,
  MATCH_DATE,
  type MatchFixture,
  matchIdOf,
} from './testing/match-fixtures.ts';

const BULK_COUNT = 95;

const directory = new D1MatchDirectory(db);

beforeEach(seedDirectoryOwners);

describe('findMatches', () => {
  test('マッチを側の番号の順の側・集計値・開始からの最終Upvote時間・該当・結果と照会の時点の状態付きで返す', async () => {
    await insertMatch(settledQualifier(1));

    const found = await directory.findMatches([matchIdOf(1)], AFTER_DECISION);

    expect(found.get(matchIdOf(1))).toEqual<MatchRecord>({
      matchId: matchIdOf(1),
      kind: 'qualifier',
      round: null,
      stage: null,
      matchDate: parseBusinessDate(MATCH_DATE),
      startsAt: STARTS_AT,
      endsAt: ENDS_AT,
      startedAt: STARTS_AT,
      decidedAt: DECIDED_AT,
      decision: 'votes',
      endedEarly: false,
      phase: 'finished',
      entries: [
        {
          entryId: entryIdOf(11),
          slot: 1,
          launchId: launchIdOf(1),
          productId: productIdOf(1),
          ownerUserId: userIdOf(1),
          upvoteCount: 12,
          lastUpvotedAt: minutesAfterStart(842),
          lastUpvoteElapsedMs: 842 * 60_000,
          forfeited: false,
          result: 'won',
        },
        {
          entryId: entryIdOf(12),
          slot: 2,
          launchId: launchIdOf(3),
          productId: productIdOf(3),
          ownerUserId: userIdOf(2),
          upvoteCount: 9,
          lastUpvotedAt: minutesAfterStart(1110),
          lastUpvoteElapsedMs: 1110 * 60_000,
          forfeited: false,
          result: 'lost',
        },
      ],
    });
  });

  test('トーナメントのラウンドと段階、即時の終了、該当、紐付けを解除した側をそのまま返す', async () => {
    await insertMatch({
      index: 2,
      columns: {
        kind: 'week',
        round: 3,
        stage: 'final',
        startedAt: STARTS_AT,
        decidedAt: DURING_MATCH,
        endedEarlyAt: DURING_MATCH,
        decision: 'walkover',
      },
      entries: [
        {
          index: 21,
          launch: null,
          product: null,
          owner: null,
          columns: { result: 'lost', forfeitedAt: DURING_MATCH },
        },
        {
          index: 22,
          launch: 2,
          product: 2,
          owner: 1,
          columns: { result: 'walkover' },
        },
      ],
    });

    const found = await directory.findMatches([matchIdOf(2)], AFTER_DECISION);
    const match = found.get(matchIdOf(2));

    expect(match).toMatchObject({
      kind: 'week',
      round: 3,
      stage: 'final',
      decision: 'walkover',
      endedEarly: true,
      phase: 'finished',
    });
    expect(match?.entries).toEqual([
      {
        entryId: entryIdOf(21),
        slot: 1,
        launchId: null,
        productId: null,
        ownerUserId: null,
        upvoteCount: 0,
        lastUpvotedAt: null,
        lastUpvoteElapsedMs: null,
        forfeited: true,
        result: 'lost',
      },
      expect.objectContaining({
        entryId: entryIdOf(22),
        slot: 2,
        forfeited: false,
        result: 'walkover',
      }),
    ]);
  });

  test('状態を開始の記録・終了の日時・確定の有無と照会の時刻から導く', async () => {
    await insertMatches([
      {
        index: 1,
        entries: [{ index: 11, launch: 2, product: 2, owner: 1 }],
      },
      {
        index: 2,
        columns: { startedAt: STARTS_AT },
        entries: [{ index: 21, launch: 4, product: 4, owner: 2 }],
      },
      settledQualifier(3),
    ]);
    const ids = [1, 2, 3].map(matchIdOf);

    const during = await directory.findMatches(ids, DURING_MATCH);
    const afterEnd = await directory.findMatches(ids, ENDS_AT);

    expect(ids.map((id) => during.get(id)?.phase)).toEqual([
      'scheduled',
      'live',
      'finished',
    ]);
    expect(ids.map((id) => afterEnd.get(id)?.phase)).toEqual([
      'scheduled',
      'tallying',
      'finished',
    ]);
  });

  test('無いマッチのIDと重複したIDを渡しても、あるマッチを1件ずつ返す', async () => {
    await insertMatch(settledQualifier(1));

    const found = await directory.findMatches(
      [matchIdOf(1), matchIdOf(1), matchIdOf(99)],
      AFTER_DECISION,
    );

    expect([...found.keys()]).toEqual([matchIdOf(1)]);
  });

  test('空の一覧には問い合わせずに空を返す', async () => {
    const recording = createRecordingDatabase();

    const found = await new D1MatchDirectory(recording.database).findMatches(
      [],
      AFTER_DECISION,
    );

    expect(found.size).toBe(0);
    expect(recording.placeholderCounts).toEqual([]);
  });

  test('90件を超えるIDはバインド変数の上限に収まるよう分けて読み、すべてを返す', async () => {
    await insertMatches(
      Array.from({ length: BULK_COUNT }, (_, offset) => ({
        index: offset + 1,
        entries: [
          { index: offset * 2 + 1, launch: null, product: null, owner: null },
          { index: offset * 2 + 2, launch: null, product: null, owner: null },
        ],
      })),
    );
    const recording = createRecordingDatabase();
    const ids = Array.from({ length: BULK_COUNT }, (_, offset) =>
      matchIdOf(offset + 1),
    );

    const found = await new D1MatchDirectory(recording.database).findMatches(
      ids,
      DURING_MATCH,
    );

    expect(found.size).toBe(BULK_COUNT);
    for (const [offset, id] of ids.entries()) {
      expect(
        found
          .get(id)
          ?.entries.map((entry) => [entry.slot, entry.entryId] as const),
      ).toEqual([
        [1, entryIdOf(offset * 2 + 1)],
        [2, entryIdOf(offset * 2 + 2)],
      ]);
    }
    expectSplitWithinBindLimit(recording.placeholderCounts);
  });
});

describe('listForDate', () => {
  beforeEach(async () => {
    await insertMatches([
      {
        index: 3,
        entries: [{ index: 31, launch: 1, product: 1, owner: 1 }],
      },
      {
        index: 1,
        entries: [{ index: 11, launch: 2, product: 2, owner: 1 }],
      },
      {
        index: 2,
        columns: { kind: 'week', round: 1 },
        entries: [{ index: 21, launch: 3, product: 3, owner: 2 }],
      },
      {
        index: 4,
        columns: {
          matchDate: '2026-11-21',
          startsAt: new Date(STARTS_AT.getTime() + 86_400_000),
          endsAt: new Date(ENDS_AT.getTime() + 86_400_000),
        },
        entries: [{ index: 41, launch: 4, product: 4, owner: 2 }],
      },
    ]);
  });

  test('指定した実施日と種別のマッチだけを、マッチのIDの昇順で返す', async () => {
    const listed = await directory.listForDate({
      date: parseBusinessDate(MATCH_DATE),
      kinds: ['qualifier'],
      now: DURING_MATCH,
    });

    expect(listed.map((match) => match.matchId)).toEqual([
      matchIdOf(1),
      matchIdOf(3),
    ]);
    expect(listed[0]?.entries.map((entry) => entry.entryId)).toEqual([
      entryIdOf(11),
    ]);
  });

  test('複数の種別を指定すると、その種別のマッチをまとめて返す', async () => {
    const listed = await directory.listForDate({
      date: parseBusinessDate(MATCH_DATE),
      kinds: ['qualifier', 'week'],
      now: DURING_MATCH,
    });

    expect(listed.map((match) => match.matchId)).toEqual([
      matchIdOf(1),
      matchIdOf(2),
      matchIdOf(3),
    ]);
  });

  test('種別の指定が空なら空を返す', async () => {
    const listed = await directory.listForDate({
      date: parseBusinessDate(MATCH_DATE),
      kinds: [],
      now: DURING_MATCH,
    });

    expect(listed).toEqual([]);
  });
});

describe('listByLaunches', () => {
  test('ローンチごとに、相手の側を含むマッチを実施日の新しい順で返し、マッチの無いローンチを含めない', async () => {
    await insertMatches([
      settledQualifier(1),
      {
        index: 2,
        columns: {
          kind: 'week',
          round: 1,
          matchDate: '2026-11-23',
          startsAt: new Date(STARTS_AT.getTime() + 3 * 86_400_000),
          endsAt: new Date(ENDS_AT.getTime() + 3 * 86_400_000),
        },
        entries: [{ index: 21, launch: 1, product: 1, owner: 1 }],
      },
    ]);

    const found = await directory.listByLaunches(
      [launchIdOf(1), launchIdOf(3), launchIdOf(4)],
      AFTER_DECISION,
    );

    expect([...found.keys()].toSorted()).toEqual([
      launchIdOf(1),
      launchIdOf(3),
    ]);
    expect(found.get(launchIdOf(1))?.map((match) => match.matchId)).toEqual([
      matchIdOf(2),
      matchIdOf(1),
    ]);
    expect(
      found
        .get(launchIdOf(3))
        ?.map((match) => match.entries.map((entry) => entry.launchId)),
    ).toEqual([[launchIdOf(1), launchIdOf(3)]]);
  });

  test('90件を超えるローンチのIDはバインド変数の上限に収まるよう分けて読む', async () => {
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
    const recording = createRecordingDatabase();

    const found = await new D1MatchDirectory(recording.database).listByLaunches(
      Array.from({ length: BULK_COUNT }, (_, offset) =>
        launchIdOf(100 + offset),
      ),
      DURING_MATCH,
    );

    expect(found.size).toBe(BULK_COUNT);
    expectSplitWithinBindLimit(recording.placeholderCounts);
  });

  test('同じマッチの2つの側のローンチが別の読み取りの単位に入っても、各ローンチにそのマッチを側2つで1回だけ返す', async () => {
    await insertMatch(settledQualifier(1));
    const fillers = Array.from({ length: 89 }, (_, offset) =>
      launchIdOf(500 + offset),
    );

    const found = await directory.listByLaunches(
      [launchIdOf(1), ...fillers, launchIdOf(3)],
      AFTER_DECISION,
    );

    expect([...found.keys()].toSorted()).toEqual([
      launchIdOf(1),
      launchIdOf(3),
    ]);
    for (const launchId of [launchIdOf(1), launchIdOf(3)]) {
      const listed = found.get(launchId);
      expect(listed?.map((match) => match.matchId)).toEqual([matchIdOf(1)]);
      expect(listed?.[0]?.entries.map((entry) => entry.slot)).toEqual([1, 2]);
      expect(listed?.[0]?.entries.map((entry) => entry.entryId)).toEqual([
        entryIdOf(11),
        entryIdOf(12),
      ]);
    }
  });
});

describe('findQualifierResults', () => {
  test('結果が確定した予選の側だけを、結果・集計値・確定の日時付きでローンチごとに返す', async () => {
    await insertMatches([
      settledQualifier(1),
      {
        index: 2,
        entries: [{ index: 21, launch: 2, product: 2, owner: 1 }],
      },
      {
        index: 3,
        columns: {
          kind: 'week',
          round: 1,
          startedAt: STARTS_AT,
          decidedAt: DECIDED_AT,
          decision: 'bye',
        },
        entries: [
          {
            index: 31,
            launch: 4,
            product: 4,
            owner: 2,
            columns: { result: 'bye' },
          },
        ],
      },
    ]);

    const found = await directory.findQualifierResults(
      [1, 2, 3, 4].map(launchIdOf),
    );

    expect([...found.keys()].toSorted()).toEqual([
      launchIdOf(1),
      launchIdOf(3),
    ]);
    expect(found.get(launchIdOf(1))).toEqual({
      launchId: launchIdOf(1),
      matchId: matchIdOf(1),
      result: 'won',
      upvoteCount: 12,
      lastUpvotedAt: minutesAfterStart(842),
      decidedAt: DECIDED_AT,
    });
    expect(found.get(launchIdOf(3))).toMatchObject({
      result: 'lost',
      upvoteCount: 9,
    });
  });

  test('90件を超えるローンチのIDはバインド変数の上限に収まるよう分けて読む', async () => {
    const recording = createRecordingDatabase();

    await new D1MatchDirectory(recording.database).findQualifierResults(
      Array.from({ length: BULK_COUNT }, (_, offset) =>
        launchIdOf(100 + offset),
      ),
    );

    expectSplitWithinBindLimit(recording.placeholderCounts);
  });
});

describe('summarizeDaily', () => {
  const NEXT_DATE = '2026-11-21';
  const NEXT_DAY_MS = 86_400_000;

  function qualifierOn(
    index: number,
    columns: MatchFixture['columns'],
    entryCount: 1 | 2,
    upvoteCounts: readonly number[] = [0, 0],
  ): MatchFixture {
    return {
      index,
      columns,
      entries: Array.from({ length: entryCount }, (_, offset) => ({
        index: index * 10 + offset + 1,
        launch: null,
        product: null,
        owner: null,
        columns: { upvoteCount: upvoteCounts[offset] ?? 0 },
      })),
    };
  }

  beforeEach(async () => {
    await insertMatches([
      qualifierOn(
        1,
        { startedAt: STARTS_AT, decidedAt: DECIDED_AT, decision: 'votes' },
        2,
        [12, 9],
      ),
      qualifierOn(2, { startedAt: STARTS_AT }, 2, [3, 1]),
      qualifierOn(
        3,
        {
          startedAt: STARTS_AT,
          decidedAt: DURING_MATCH,
          endedEarlyAt: DURING_MATCH,
          decision: 'walkover',
        },
        2,
        [4, 0],
      ),
      qualifierOn(
        4,
        { startedAt: STARTS_AT, decidedAt: STARTS_AT, decision: 'bye' },
        1,
      ),
      qualifierOn(
        5,
        { startedAt: STARTS_AT, decidedAt: STARTS_AT, decision: 'walkover' },
        2,
      ),
      qualifierOn(
        6,
        {
          startedAt: STARTS_AT,
          decidedAt: STARTS_AT,
          decision: 'both_forfeited',
        },
        2,
      ),
      qualifierOn(7, {}, 2),
      qualifierOn(
        8,
        {
          kind: 'week',
          round: 1,
          startedAt: STARTS_AT,
          decidedAt: DECIDED_AT,
          decision: 'votes',
        },
        2,
        [5, 2],
      ),
      qualifierOn(
        9,
        {
          matchDate: NEXT_DATE,
          startsAt: new Date(STARTS_AT.getTime() + NEXT_DAY_MS),
          endsAt: new Date(ENDS_AT.getTime() + NEXT_DAY_MS),
          startedAt: new Date(STARTS_AT.getTime() + NEXT_DAY_MS),
          decidedAt: new Date(DECIDED_AT.getTime() + NEXT_DAY_MS),
          decision: 'no_votes',
        },
        2,
      ),
    ]);
  });

  test('日ごとに、開始した2つの側の予選の数(即時の終了を含み不戦勝と開始時点の決着を除く)と確定したマッチのUpvote数の合計を返す', async () => {
    const summaries = await directory.summarizeDaily({
      from: parseBusinessDate('2026-11-19'),
      to: parseBusinessDate('2026-11-22'),
    });

    expect(summaries).toEqual([
      { date: '2026-11-19', qualifierMatches: 0, upvotes: 0 },
      { date: MATCH_DATE, qualifierMatches: 3, upvotes: 12 + 9 + 4 + 5 + 2 },
      { date: NEXT_DATE, qualifierMatches: 1, upvotes: 0 },
      { date: '2026-11-22', qualifierMatches: 0, upvotes: 0 },
    ]);
  });

  test('期間の両端が同じ日なら1日分を返す', async () => {
    const summaries = await directory.summarizeDaily({
      from: parseBusinessDate(NEXT_DATE),
      to: parseBusinessDate(NEXT_DATE),
    });

    expect(summaries).toEqual([
      { date: NEXT_DATE, qualifierMatches: 1, upvotes: 0 },
    ]);
  });

  test('366日までの期間を読め、それを超える期間と開始が終わりより後の期間を拒否する', async () => {
    const yearLong = await directory.summarizeDaily({
      from: parseBusinessDate('2026-01-01'),
      to: parseBusinessDate('2027-01-01'),
    });

    expect(yearLong).toHaveLength(366);
    await expect(
      directory.summarizeDaily({
        from: parseBusinessDate('2026-01-01'),
        to: parseBusinessDate('2027-01-02'),
      }),
    ).rejects.toThrow(RangeError);
    await expect(
      directory.summarizeDaily({
        from: parseBusinessDate(NEXT_DATE),
        to: parseBusinessDate(MATCH_DATE),
      }),
    ).rejects.toThrow(RangeError);
  });
});
