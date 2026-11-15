import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { configureSync, type LogRecord, resetSync } from '@logtape/logtape';

import type { MatchRecord } from '../../../lib/core/match/ports.ts';
import {
  type BusinessDate,
  fromBusinessDateTime,
  parseBusinessDate,
} from '../../../lib/core/time/business-time.ts';
import { DirectoryMatchViewReader } from './match-view-reader.ts';
import { DirectoryQualifierBoardReader } from './qualifier-board-reader.ts';
import {
  createFakeKickoffProductDirectory,
  productSummaryOf,
} from './testing/kickoff-fakes.ts';
import { voterOf } from './testing/upvote-fakes.ts';
import {
  createFakeMatchBoardStore,
  createFakeMatchDirectory,
  createFakePairingDays,
  matchRecordOf,
  VIEW_DATE,
  VIEW_NOW,
  VIEW_WINDOW,
  viewEntryIdOf,
  viewMatchIdOf,
  viewProductIdOf,
} from './testing/view-fakes.ts';

const records: LogRecord[] = [];

beforeEach(() => {
  records.length = 0;
  configureSync({
    reset: true,
    sinks: {
      capture: (record) => {
        records.push(record);
      },
    },
    loggers: [
      { category: ['api'], sinks: ['capture'], lowestLevel: 'debug' },
      { category: ['logtape', 'meta'], sinks: [], lowestLevel: 'warning' },
    ],
  });
});

afterEach(() => {
  resetSync();
});

function matchLogs() {
  return records
    .filter((record) => record.category.join('.') === 'api.application.match')
    .map(({ level, properties }) => ({ level, properties }));
}

const NEXT_DATE = parseBusinessDate('2027-03-04');

function boardOf(
  matches: readonly MatchRecord[],
  completed: ReadonlySet<BusinessDate> = new Set([VIEW_DATE]),
) {
  const directory = createFakeMatchDirectory(matches);
  const products = createFakeKickoffProductDirectory(
    matches.flatMap((record) =>
      record.entries.flatMap((entry) =>
        entry.productId === null ? [] : [productSummaryOf(entry.productId)],
      ),
    ),
    [],
  );
  const store = createFakeMatchBoardStore();
  const pairing = createFakePairingDays(completed);
  return {
    directory,
    products,
    store,
    pairing,
    reader: new DirectoryQualifierBoardReader(
      directory,
      pairing,
      new DirectoryMatchViewReader(directory, products, store),
    ),
  };
}

describe('DirectoryQualifierBoardReader の並びと分類', () => {
  test('今日の業務日付の予選を照会し、開始済みのマッチだけを合計の最大を先頭に並べる', async () => {
    const matches = [
      matchRecordOf(1, { entries: [{ upvoteCount: 2 }, { upvoteCount: 3 }] }),
      matchRecordOf(2, { entries: [{ upvoteCount: 20 }, { upvoteCount: 1 }] }),
      matchRecordOf(3, { entries: [{ upvoteCount: 0 }, { upvoteCount: 0 }] }),
      matchRecordOf(4, { startedAt: null }),
    ];
    const { reader, directory, products, store } = boardOf(matches);

    const board = await reader.read({ viewer: voterOf(), now: VIEW_NOW });

    expect(directory.dateReads).toEqual([
      { date: VIEW_DATE, kinds: ['qualifier'], now: VIEW_NOW },
    ]);
    expect(board.cards.map((view) => view.record.matchId)).toEqual([
      viewMatchIdOf(2),
      viewMatchIdOf(3),
      viewMatchIdOf(1),
    ]);
    expect(board.heldCount).toBe(3);
    expect(products.summaryReads).toHaveLength(1);
    expect(products.summaryReads[0]?.productIds).not.toContain(
      viewProductIdOf(4, 1),
    );
    expect(store.reads).toHaveLength(1);
  });

  test('対戦相手なし・開始時点の相手の該当・即時の終了を不戦勝の側と理由で末尾に分け、両者敗北を出さない', async () => {
    const decided = { decidedAt: VIEW_WINDOW.startsAt };
    const matches = [
      matchRecordOf(1),
      matchRecordOf(2, {
        ...decided,
        decision: 'bye',
        entries: [{ result: 'bye' }, null],
      }),
      matchRecordOf(3, {
        ...decided,
        decision: 'walkover',
        entries: [{ result: 'lost' }, { result: 'walkover' }],
      }),
      matchRecordOf(4, {
        decidedAt: VIEW_NOW,
        decision: 'walkover',
        endedEarly: true,
        entries: [{ result: 'walkover', upvoteCount: 7 }, { result: 'lost' }],
      }),
      matchRecordOf(5, {
        ...decided,
        decision: 'both_forfeited',
        entries: [{ result: 'lost' }, { result: 'lost' }],
      }),
    ];
    const { reader } = boardOf(matches);

    const board = await reader.read({ viewer: undefined, now: VIEW_NOW });

    expect(board.cards.map((view) => view.record.matchId)).toEqual([
      viewMatchIdOf(1),
    ]);
    expect(
      board.byes.map((bye) => ({
        matchId: bye.view.record.matchId,
        entryId: bye.entryId,
        reason: bye.reason,
      })),
    ).toEqual([
      {
        matchId: viewMatchIdOf(2),
        entryId: viewEntryIdOf(2, 1),
        reason: 'absent',
      },
      {
        matchId: viewMatchIdOf(3),
        entryId: viewEntryIdOf(3, 2),
        reason: 'forfeit',
      },
      {
        matchId: viewMatchIdOf(4),
        entryId: viewEntryIdOf(4, 1),
        reason: 'early',
      },
    ]);
    expect(board.byes[2]?.view.entries[0]?.upvoteCount).toBe(7);
    expect(board.heldCount).toBe(2);
  });

  test('側が1つで2つの側の決着の不整合なマッチは、マッチのIDだけをwarnのログに出してその1件を除く', async () => {
    const matches = [
      matchRecordOf(1),
      matchRecordOf(2, {
        decidedAt: VIEW_NOW,
        decision: 'votes',
        entries: [{ result: 'won' }, null],
      }),
    ];
    const { reader } = boardOf(matches);

    const board = await reader.read({ viewer: undefined, now: VIEW_NOW });

    expect(board.cards.map((view) => view.record.matchId)).toEqual([
      viewMatchIdOf(1),
    ]);
    expect(board.byes).toEqual([]);
    expect(matchLogs()).toEqual([
      { level: 'warning', properties: { matchId: viewMatchIdOf(2) } },
    ]);
  });

  test('予選が無い日は空の一覧と実施数0を返し、プロダクトと閲覧者のUpvoteを照会しない', async () => {
    const { reader, products, store } = boardOf([]);

    const board = await reader.read({ viewer: voterOf(), now: VIEW_NOW });

    expect(board).toMatchObject({ cards: [], byes: [], heldCount: 0 });
    expect(products.summaryReads).toEqual([]);
    expect(store.reads).toEqual([]);
  });
});

describe('DirectoryQualifierBoardReader の時刻と状態', () => {
  test.each([
    [{ hour: 23, minute: 39 }, 'live'],
    [{ hour: 23, minute: 40 }, 'result'],
  ] as const)('業務時刻%oではphaseを%sにする', async (time, expected) => {
    const now = fromBusinessDateTime(VIEW_DATE, time);
    const { reader } = boardOf([matchRecordOf(1, { now })]);

    const board = await reader.read({ viewer: undefined, now });

    expect(board.phase).toBe(expected);
  });

  test('今日の業務日付・サーバーの時刻・今日の終了の時刻・翌日のキックオフの時刻を返す', async () => {
    const now = fromBusinessDateTime(VIEW_DATE, { hour: 23, minute: 59 });
    const { reader } = boardOf([]);

    const board = await reader.read({ viewer: undefined, now });

    expect(board).toMatchObject({
      date: VIEW_DATE,
      serverTime: now,
      fullTimeAt: fromBusinessDateTime(VIEW_DATE, { hour: 23, minute: 40 }),
      nextKickoffAt: fromBusinessDateTime(NEXT_DATE, { hour: 0, minute: 0 }),
    });
  });

  test('当日のペアリングが完了し、全ての予選が開始済みならawaitingKickoffは偽', async () => {
    const { reader, pairing } = boardOf([
      matchRecordOf(1),
      matchRecordOf(2, {
        decidedAt: VIEW_WINDOW.startsAt,
        decision: 'bye',
        entries: [{ result: 'bye' }, null],
      }),
    ]);

    const board = await reader.read({ viewer: undefined, now: VIEW_NOW });

    expect(board.awaitingKickoff).toBe(false);
    expect(pairing.completionReads).toEqual([VIEW_DATE]);
  });

  test('当日のペアリングが完了していなければ、予選が無くてもawaitingKickoffは真', async () => {
    const { reader } = boardOf([], new Set());

    const board = await reader.read({ viewer: undefined, now: VIEW_NOW });

    expect(board.awaitingKickoff).toBe(true);
  });

  test('開始の日時を過ぎて開始も確定もしていない予選があればawaitingKickoffは真', async () => {
    const now = new Date(VIEW_WINDOW.startsAt.getTime() + 1000);
    const { reader } = boardOf([
      matchRecordOf(1, { now }),
      matchRecordOf(2, { startedAt: null, now }),
    ]);

    const board = await reader.read({ viewer: undefined, now });

    expect(board.awaitingKickoff).toBe(true);
    expect(board.cards.map((view) => view.record.matchId)).toEqual([
      viewMatchIdOf(1),
    ]);
  });
});
