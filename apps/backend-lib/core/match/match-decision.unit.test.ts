import { describe, expect, test } from 'bun:test';

import {
  decideAtFullTime,
  decideAtKickoff,
  type EntryTally,
} from './match-decision.ts';

// 予選ルールの判定の例の時刻は業務時刻で、業務日付09-07の14:02はUTCの09-07 22:02になる
const AT_14_02 = new Date('2026-09-07T22:02:00.000Z');
const AT_18_30 = new Date('2026-09-08T02:30:00.000Z');

function tally(
  entryId: string,
  upvoteCount: number,
  lastUpvotedAt: Date | null = null,
  lastUpvoteSeq: number | null = null,
): EntryTally {
  return { entryId, upvoteCount, lastUpvotedAt, lastUpvoteSeq };
}

describe('decideAtFullTime', () => {
  test('12対9はUpvote数の多いA3の勝利になる', () => {
    const outcome = decideAtFullTime([
      tally('A3', 12, new Date('2026-09-08T01:00:00.000Z'), 30),
      tally('A1', 9, new Date('2026-09-08T03:00:00.000Z'), 31),
    ]);

    expect(outcome.decision).toBe('votes');
    expect(outcome.results).toEqual(
      new Map([
        ['A3', 'won'],
        ['A1', 'lost'],
      ]),
    );
  });

  test('Upvote数の少ない側が1つ目でも、多い側の勝利になる', () => {
    const outcome = decideAtFullTime([
      tally('D3', 0),
      tally('D1', 3, AT_14_02, 3),
    ]);

    expect(outcome.decision).toBe('votes');
    expect(outcome.results).toEqual(
      new Map([
        ['D3', 'lost'],
        ['D1', 'won'],
      ]),
    );
  });

  test('3対0はUpvote数の多いD1の勝利になる', () => {
    const outcome = decideAtFullTime([
      tally('D1', 3, AT_14_02, 3),
      tally('O1', 0),
    ]);

    expect(outcome.decision).toBe('votes');
    expect(outcome.results).toEqual(
      new Map([
        ['D1', 'won'],
        ['O1', 'lost'],
      ]),
    );
  });

  test('7対7で最終Upvote時間が14:02と18:30なら、早いA5の勝利になる', () => {
    const outcome = decideAtFullTime([
      tally('A5', 7, AT_14_02, 10),
      tally('A2', 7, AT_18_30, 14),
    ]);

    expect(outcome.decision).toBe('last_upvote');
    expect(outcome.results).toEqual(
      new Map([
        ['A5', 'won'],
        ['A2', 'lost'],
      ]),
    );
  });

  test('同数で最終Upvote時間の早い側が2つ目でも、早い側の勝利になる', () => {
    const outcome = decideAtFullTime([
      tally('A2', 7, AT_18_30, 14),
      tally('A5', 7, AT_14_02, 10),
    ]);

    expect(outcome.decision).toBe('last_upvote');
    expect(outcome.results).toEqual(
      new Map([
        ['A2', 'lost'],
        ['A5', 'won'],
      ]),
    );
  });

  test('同数で最終Upvote時間がミリ秒まで一致すると、先に記録されたUpvoteの側の勝利になる(仮2)', () => {
    const outcome = decideAtFullTime([
      tally('X', 4, AT_14_02, 9),
      tally('Y', 4, AT_14_02, 8),
    ]);

    expect(outcome.decision).toBe('last_upvote');
    expect(outcome.results).toEqual(
      new Map([
        ['X', 'lost'],
        ['Y', 'won'],
      ]),
    );
  });

  test('0対0は両者敗北になる', () => {
    const outcome = decideAtFullTime([tally('D2', 0), tally('D3', 0)]);

    expect(outcome.decision).toBe('no_votes');
    expect(outcome.results).toEqual(
      new Map([
        ['D2', 'lost'],
        ['D3', 'lost'],
      ]),
    );
  });

  test('同数で1以上なのに最終Upvote時間が無い集計値は不整合として例外にする', () => {
    expect(() =>
      decideAtFullTime([tally('X', 2, null, null), tally('Y', 2, AT_14_02, 3)]),
    ).toThrow(RangeError);
  });

  test('同数で最終Upvote時間が一致し記録の順が無い集計値は不整合として例外にする', () => {
    expect(() =>
      decideAtFullTime([
        tally('X', 2, AT_14_02, null),
        tally('Y', 2, AT_14_02, 3),
      ]),
    ).toThrow(RangeError);
  });
});

describe('decideAtKickoff', () => {
  test('側が1つで該当しなければ、その側の不戦勝で決着する', () => {
    expect(decideAtKickoff([{ entryId: 'A4', forfeited: false }])).toEqual({
      kind: 'decided',
      outcome: { decision: 'bye', results: new Map([['A4', 'bye']]) },
    });
  });

  test('側が1つで該当すれば、その側の敗北で決着する', () => {
    expect(decideAtKickoff([{ entryId: 'A4', forfeited: true }])).toEqual({
      kind: 'decided',
      outcome: {
        decision: 'both_forfeited',
        results: new Map([['A4', 'lost']]),
      },
    });
  });

  test('側が2つでどちらも該当しなければ、開始する', () => {
    expect(
      decideAtKickoff([
        { entryId: 'A3', forfeited: false },
        { entryId: 'A1', forfeited: false },
      ]),
    ).toEqual({ kind: 'start' });
  });

  test('一方だけが該当すれば、もう一方の相手の退会等による勝利で決着する', () => {
    expect(
      decideAtKickoff([
        { entryId: 'A3', forfeited: true },
        { entryId: 'A1', forfeited: false },
      ]),
    ).toEqual({
      kind: 'decided',
      outcome: {
        decision: 'walkover',
        results: new Map([
          ['A3', 'lost'],
          ['A1', 'walkover'],
        ]),
      },
    });
  });

  test('2つ目の側だけが該当しても、1つ目の側の相手の退会等による勝利で決着する', () => {
    expect(
      decideAtKickoff([
        { entryId: 'A3', forfeited: false },
        { entryId: 'A1', forfeited: true },
      ]),
    ).toEqual({
      kind: 'decided',
      outcome: {
        decision: 'walkover',
        results: new Map([
          ['A3', 'walkover'],
          ['A1', 'lost'],
        ]),
      },
    });
  });

  test('両方が該当すれば、両者敗北で決着する(仮4)', () => {
    expect(
      decideAtKickoff([
        { entryId: 'A3', forfeited: true },
        { entryId: 'A1', forfeited: true },
      ]),
    ).toEqual({
      kind: 'decided',
      outcome: {
        decision: 'both_forfeited',
        results: new Map([
          ['A3', 'lost'],
          ['A1', 'lost'],
        ]),
      },
    });
  });

  test.each([
    ['0個', []],
    [
      '3個',
      [
        { entryId: 'A', forfeited: false },
        { entryId: 'B', forfeited: false },
        { entryId: 'C', forfeited: false },
      ],
    ],
  ])('側が%sなら例外にする', (_label, entries) => {
    expect(() => decideAtKickoff(entries)).toThrow(RangeError);
  });
});
