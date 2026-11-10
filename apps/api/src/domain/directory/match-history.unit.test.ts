import { describe, expect, test } from 'bun:test';

import type { EntryResult } from '../../../lib/core/match/match-model.ts';
import type {
  MatchEntryRecord,
  MatchRecord,
} from '../../../lib/core/match/ports.ts';
import type { LaunchStatus } from '../../../lib/core/product/launch-status.ts';
import type {
  LaunchRecord,
  ProductSummaryRecord,
} from '../../../lib/core/product/ports.ts';
import { parseBusinessDate } from '../../../lib/core/time/business-time.ts';
import {
  type HistoryRow,
  isKickedOff,
  summarizeRecord,
  toHistoryRows,
} from './match-history.ts';

const PRODUCT_ID = 'product-1';
const OPPONENT_ID = 'product-2';

const ownEntry = (
  overrides: Partial<MatchEntryRecord> = {},
): MatchEntryRecord => ({
  entryId: 'entry-own',
  slot: 1,
  launchId: 'launch-1',
  productId: PRODUCT_ID,
  ownerUserId: 'owner-1',
  upvoteCount: 12,
  lastUpvotedAt: null,
  lastUpvoteElapsedMs: null,
  forfeited: false,
  result: 'won',
  ...overrides,
});

const opponentEntry = (
  overrides: Partial<MatchEntryRecord> = {},
): MatchEntryRecord => ({
  entryId: 'entry-opponent',
  slot: 2,
  launchId: 'launch-2',
  productId: OPPONENT_ID,
  ownerUserId: 'owner-2',
  upvoteCount: 9,
  lastUpvotedAt: null,
  lastUpvoteElapsedMs: null,
  forfeited: false,
  result: 'lost',
  ...overrides,
});

const match = (overrides: Partial<MatchRecord> = {}): MatchRecord => ({
  matchId: 'match-1',
  kind: 'qualifier',
  round: null,
  stage: null,
  matchDate: parseBusinessDate('2026-09-15'),
  decision: 'votes',
  endedEarly: false,
  phase: 'finished',
  startsAt: new Date('2026-09-14T15:00:00.000Z'),
  endsAt: new Date('2026-09-15T14:40:00.000Z'),
  startedAt: new Date('2026-09-14T15:00:00.000Z'),
  decidedAt: new Date('2026-09-15T14:40:00.000Z'),
  entries: [ownEntry(), opponentEntry()],
  ...overrides,
});

const summary = (
  overrides: Partial<ProductSummaryRecord> = {},
): ProductSummaryRecord => ({
  productId: OPPONENT_ID,
  ownerUserId: 'owner-2',
  handle: 'opponent',
  name: '対戦相手',
  tagline: 'タグライン',
  category: { id: 'category-1', name: '開発ツール', handle: 'dev-tools' },
  websiteUrl: 'https://opponent.example/',
  logoFileId: 'file-1',
  hidden: false,
  visible: true,
  listed: true,
  createdAt: new Date('2026-08-01T00:00:00.000Z'),
  ...overrides,
});

const opponentsOf = (
  ...records: readonly ProductSummaryRecord[]
): ReadonlyMap<string, ProductSummaryRecord> =>
  new Map(records.map((record) => [record.productId, record]));

const rowsOf = (
  matches: readonly MatchRecord[],
  opponents: ReadonlyMap<string, ProductSummaryRecord> = opponentsOf(summary()),
): readonly HistoryRow[] =>
  toHistoryRows({ productId: PRODUCT_ID, matches, opponents });

const onlyRow = (
  target: MatchRecord,
  opponents?: ReadonlyMap<string, ProductSummaryRecord>,
): HistoryRow => {
  const rows = rowsOf([target], opponents);
  expect(rows).toHaveLength(1);
  return rows[0] as HistoryRow;
};

describe('toHistoryRows', () => {
  test('確定したマッチを自分の側の結果とUpvote数で行にする', () => {
    expect(onlyRow(match())).toEqual({
      matchId: 'match-1',
      entryId: 'entry-own',
      kind: 'qualifier',
      round: null,
      stage: null,
      matchDate: parseBusinessDate('2026-09-15'),
      result: 'won',
      decision: 'votes',
      endedEarly: false,
      ownUpvoteCount: 12,
      opponentUpvoteCount: 9,
      opponent: { kind: 'listed', productId: OPPONENT_ID },
    });
  });

  test('側の番号に依らずプロダクトのIDで自分の側を選ぶ', () => {
    const row = onlyRow(
      match({
        entries: [
          opponentEntry({ slot: 1, result: 'won', upvoteCount: 20 }),
          ownEntry({ slot: 2, result: 'lost', upvoteCount: 4 }),
        ],
      }),
    );
    expect(row).toMatchObject({
      entryId: 'entry-own',
      result: 'lost',
      ownUpvoteCount: 4,
      opponentUpvoteCount: 20,
    });
  });

  test.each([['scheduled'], ['live'], ['tallying']] as const)(
    '確定前(%s)のマッチは行にしない',
    (phase) => {
      expect(rowsOf([match({ phase, decidedAt: null })])).toEqual([]);
    },
  );

  test('実施日の新しい順に並べる', () => {
    const rows = rowsOf([
      match({ matchId: 'old', matchDate: parseBusinessDate('2026-09-01') }),
      match({
        matchId: 'new',
        kind: 'week',
        round: 3,
        stage: 'final',
        matchDate: parseBusinessDate('2026-09-20'),
      }),
      match({ matchId: 'middle', matchDate: parseBusinessDate('2026-09-15') }),
    ]);
    expect(rows.map((row) => row.matchId)).toEqual(['new', 'middle', 'old']);
    expect(rows[0]).toMatchObject({ kind: 'week', round: 3, stage: 'final' });
  });

  test('同じ実施日のマッチは確定の新しい順に並べる', () => {
    const rows = rowsOf([
      match({
        matchId: 'earlier',
        decidedAt: new Date('2026-09-15T10:00:00.000Z'),
      }),
      match({
        matchId: 'later',
        decidedAt: new Date('2026-09-15T14:40:00.000Z'),
      }),
    ]);
    expect(rows.map((row) => row.matchId)).toEqual(['later', 'earlier']);
  });

  test('自分の側が無いマッチは行にしない', () => {
    expect(
      rowsOf([
        match({
          entries: [
            ownEntry({ productId: null, launchId: null }),
            opponentEntry(),
          ],
        }),
      ]),
    ).toEqual([]);
  });

  test('確定したマッチの自分の側に結果が無ければ例外にする', () => {
    expect(() =>
      rowsOf([
        match({ entries: [ownEntry({ result: null }), opponentEntry()] }),
      ]),
    ).toThrow(RangeError);
  });

  describe('対戦相手の見え方', () => {
    test('掲載中の相手はリンクできる相手にする', () => {
      expect(onlyRow(match()).opponent).toEqual({
        kind: 'listed',
        productId: OPPONENT_ID,
      });
    });

    test('可視だが未掲載の相手はリンクしない相手にする', () => {
      expect(
        onlyRow(match(), opponentsOf(summary({ listed: false }))).opponent,
      ).toEqual({ kind: 'unlisted', productId: OPPONENT_ID });
    });

    test('可視でない(非公開化・投稿者の退会や停止)相手は非公開にする', () => {
      expect(
        onlyRow(
          match(),
          opponentsOf(summary({ visible: false, listed: false, hidden: true })),
        ).opponent,
      ).toEqual({ kind: 'private' });
    });

    test('照会に無い(論理削除)相手は非公開にする', () => {
      expect(onlyRow(match(), opponentsOf()).opponent).toEqual({
        kind: 'private',
      });
    });

    test('物理削除で紐付けを解除した相手は非公開にし、相手の数は残す', () => {
      const row = onlyRow(
        match({
          entries: [
            ownEntry(),
            opponentEntry({
              productId: null,
              launchId: null,
              ownerUserId: null,
            }),
          ],
        }),
      );
      expect(row.opponent).toEqual({ kind: 'private' });
      expect(row.opponentUpvoteCount).toBe(9);
    });

    test('側が1つのマッチは対戦相手なしにする', () => {
      expect(
        onlyRow(
          match({
            decision: 'bye',
            startedAt: null,
            entries: [ownEntry({ result: 'bye', upvoteCount: 0 })],
          }),
        ).opponent,
      ).toEqual({ kind: 'none' });
    });
  });

  describe('接戦', () => {
    test.each([
      ['won', 9],
      ['lost', 9],
    ] as const)(
      '最終Upvote時間で決まった%sの行は決着を接戦として残す',
      (result, count) => {
        const row = onlyRow(
          match({
            decision: 'last_upvote',
            entries: [
              ownEntry({ result, upvoteCount: count }),
              opponentEntry({
                result: result === 'won' ? 'lost' : 'won',
                upvoteCount: count,
              }),
            ],
          }),
        );
        expect(row).toMatchObject({
          decision: 'last_upvote',
          result,
          ownUpvoteCount: count,
          opponentUpvoteCount: count,
        });
      },
    );
  });

  describe('不戦勝', () => {
    test('対戦相手のいない不戦勝は相手の数を欠く', () => {
      const row = onlyRow(
        match({
          decision: 'bye',
          startedAt: null,
          entries: [ownEntry({ result: 'bye', upvoteCount: 0 })],
        }),
      );
      expect(row).toMatchObject({
        result: 'bye',
        decision: 'bye',
        opponentUpvoteCount: null,
        opponent: { kind: 'none' },
      });
    });

    test('開始時点の相手の退会等による不戦勝は、掲載中の相手でも非公開にし相手の数を欠く', () => {
      const row = onlyRow(
        match({
          decision: 'walkover',
          startedAt: null,
          entries: [
            ownEntry({ result: 'walkover', upvoteCount: 0 }),
            opponentEntry({ forfeited: true, upvoteCount: 0 }),
          ],
        }),
      );
      expect(row).toMatchObject({
        result: 'walkover',
        endedEarly: false,
        opponentUpvoteCount: null,
        opponent: { kind: 'private' },
      });
    });

    test('早期の不戦勝は相手を非公開にし、確定時点の自分の数だけを残す', () => {
      const row = onlyRow(
        match({
          decision: 'walkover',
          endedEarly: true,
          entries: [
            ownEntry({ result: 'walkover', upvoteCount: 7 }),
            opponentEntry({ forfeited: true, upvoteCount: 5 }),
          ],
        }),
      );
      expect(row).toMatchObject({
        result: 'walkover',
        endedEarly: true,
        ownUpvoteCount: 7,
        opponentUpvoteCount: null,
        opponent: { kind: 'private' },
      });
    });
  });

  test.each([
    ['両者0票', 'no_votes', true],
    ['両方の側の該当', 'both_forfeited', false],
  ] as const)('両者敗北(%s)は敗北の行にする', (_, decision, started) => {
    const row = onlyRow(
      match({
        decision,
        startedAt: started ? new Date('2026-09-14T15:00:00.000Z') : null,
        entries: [
          ownEntry({ result: 'lost', upvoteCount: 0 }),
          opponentEntry({ result: 'lost', upvoteCount: 0 }),
        ],
      }),
    );
    expect(row).toMatchObject({
      result: 'lost',
      decision,
      ownUpvoteCount: 0,
      opponentUpvoteCount: 0,
    });
  });
});

const launch = (
  launchId: string,
  launchDate: string,
  status: LaunchStatus,
): LaunchRecord => ({
  launchId,
  productId: PRODUCT_ID,
  number: status === 'canceled' ? 0 : 1,
  launchDate: parseBusinessDate(launchDate),
  status,
  outcome: status === 'finished' ? 'won' : null,
  decidedAt: null,
});

const rowWith = (result: EntryResult): HistoryRow =>
  onlyRow(
    match({
      entries: [
        ownEntry({ result }),
        opponentEntry({ result: result === 'lost' ? 'won' : 'lost' }),
      ],
    }),
  );

describe('summarizeRecord', () => {
  test('勝利・不戦勝・早期の不戦勝を勝ち、敗北と両者敗北を負けとして数える', () => {
    const rows = [
      rowWith('won'),
      rowWith('bye'),
      rowWith('walkover'),
      rowWith('lost'),
      onlyRow(
        match({
          decision: 'no_votes',
          entries: [
            ownEntry({ result: 'lost', upvoteCount: 0 }),
            opponentEntry({ result: 'lost', upvoteCount: 0 }),
          ],
        }),
      ),
    ];
    expect(summarizeRecord({ rows, launches: [] })).toMatchObject({
      wins: 3,
      losses: 2,
    });
  });

  test('初ローンチ日とローンチ回数はキックオフ済みで取り消されていないローンチから求める', () => {
    const launches = [
      launch('scheduled', '2026-10-20', 'scheduled'),
      launch('paired', '2026-10-01', 'paired'),
      launch('in-progress', '2026-09-30', 'in_progress'),
      launch('finished-old', '2026-09-08', 'finished'),
      launch('finished-new', '2026-09-15', 'finished'),
      launch('canceled', '2026-09-01', 'canceled'),
    ];
    expect(summarizeRecord({ rows: [], launches })).toEqual({
      firstLaunchDate: parseBusinessDate('2026-09-08'),
      launchCount: 3,
      wins: 0,
      losses: 0,
    });
  });

  test('キックオフ済みのローンチが無ければ初ローンチ日を欠き回数を0にする', () => {
    expect(
      summarizeRecord({
        rows: [],
        launches: [
          launch('scheduled', '2026-10-20', 'scheduled'),
          launch('canceled', '2026-09-01', 'canceled'),
        ],
      }),
    ).toEqual({ firstLaunchDate: null, launchCount: 0, wins: 0, losses: 0 });
  });
});

describe('isKickedOff', () => {
  test.each([
    ['scheduled', false],
    ['paired', false],
    ['in_progress', true],
    ['finished', true],
    ['canceled', false],
  ] as const)('%sのローンチのキックオフ済みは%s', (status, expected) => {
    expect(isKickedOff({ status })).toBe(expected);
  });
});
