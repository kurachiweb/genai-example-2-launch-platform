import { describe, expect, test } from 'bun:test';

import type { BusinessDate } from '../time/business-time.ts';
import { planNext } from './bracket-progress-plan.ts';
import { bracketShape } from './bracket-shape.ts';
import type {
  BracketMatchRecord,
  BracketParticipantRecord,
  BracketRecord,
} from './ports.ts';

const MATCH_DATE = '2026-11-24' as BusinessDate;
const ULID_LENGTH = 26;

function ulidOf(prefix: string, serial: number): string {
  return `${prefix}${String(serial).padStart(ULID_LENGTH - prefix.length, '0')}`;
}

interface MatchInput {
  readonly round: number;
  readonly position: number;
  readonly participantNos: BracketMatchRecord['participantNos'];
  readonly status?: BracketMatchRecord['status'];
  readonly winnerNo?: number | null;
}

function participant(
  participantNo: number,
  linked: boolean,
): BracketParticipantRecord {
  return {
    participantNo,
    ref: ulidOf('01JD0ENTRY', participantNo),
    productId: linked ? ulidOf('01JD0PR0D', participantNo) : null,
    launchId: linked ? ulidOf('01JD0RE1EASE', participantNo) : null,
    ownerUserId: linked ? ulidOf('01JD0VSER', participantNo) : null,
    eliminatedRound: null,
  };
}

function match({
  round,
  position,
  participantNos,
  status = 'decided',
  winnerNo = null,
}: MatchInput): BracketMatchRecord {
  return {
    matchId: ulidOf('01JD0MATCH', round * 100 + position),
    round,
    position,
    matchDate: MATCH_DATE,
    participantNos,
    status,
    winnerNo,
  };
}

function recordOf(
  participantCount: number,
  matches: readonly MatchInput[],
  unlinked: readonly number[] = [],
): BracketRecord {
  return {
    bracketId: ulidOf('01JD0BRACKET', 1),
    kind: 'week',
    tournamentId: ulidOf('01JD0T0VRNAMENT', 1),
    shape: bracketShape(participantCount),
    firstRoundDate: MATCH_DATE,
    status: 'active',
    outcome: null,
    championRef: null,
    participants: Array.from({ length: participantCount }, (_, index) =>
      participant(index + 1, !unlinked.includes(index + 1)),
    ),
    matches: matches.map(match),
  };
}

function decided(
  round: number,
  position: number,
  participantNos: BracketMatchRecord['participantNos'],
  winnerNo: number | null,
): MatchInput {
  return { round, position, participantNos, winnerNo };
}

describe('planNext(参加者が全て紐付いている記録)', () => {
  test('記録が無ければ1回戦の全ての位置を予定し、敗退は無い', () => {
    expect(planNext(recordOf(4, []))).toEqual({
      kind: 'schedule',
      round: 1,
      nodes: [
        { round: 1, position: 1, participants: [1, 2] },
        { round: 1, position: 2, participants: [3, 4] },
      ],
      dropped: [],
    });
  });

  test.each([
    [0, null],
    [1, 1],
  ])(
    '参加%iなら予定を作らずに終え、優勝は%pになる',
    (participantCount, championNo) => {
      expect(planNext(recordOf(participantCount, []))).toEqual({
        kind: 'finish',
        championNo,
        dropped: [],
      });
    },
  );

  test('現在のラウンドに予定済みで未確定のマッチがあれば待つ', () => {
    const record = recordOf(4, [
      decided(1, 1, [1, 2], 1),
      { round: 1, position: 2, participantNos: [3, 4], status: 'scheduled' },
    ]);

    expect(planNext(record)).toEqual({ kind: 'wait' });
  });

  test('予定の作成の前に中断した位置(planned)のラウンドは、前ラウンドの結果から作り直す', () => {
    const record = recordOf(4, [
      decided(1, 1, [1, 2], 1),
      decided(1, 2, [3, 4], 4),
      { round: 2, position: 1, participantNos: [1, 4], status: 'planned' },
    ]);

    expect(planNext(record)).toEqual({
      kind: 'schedule',
      round: 2,
      nodes: [{ round: 2, position: 1, participants: [1, 4] }],
      dropped: [],
    });
  });

  test('1回戦の位置が全てplannedなら、記録が無い場合と同じく1回戦を予定し直す', () => {
    const record = recordOf(4, [
      { round: 1, position: 1, participantNos: [1, 2], status: 'planned' },
      { round: 1, position: 2, participantNos: [3, 4], status: 'planned' },
    ]);

    expect(planNext(record)).toEqual({
      kind: 'schedule',
      round: 1,
      nodes: [
        { round: 1, position: 1, participants: [1, 2] },
        { round: 1, position: 2, participants: [3, 4] },
      ],
      dropped: [],
    });
  });

  test('側は枠の並びによらず抽選番号の昇順にそろえる', () => {
    const record = recordOf(8, [
      decided(1, 1, [1, 2], 1),
      decided(1, 2, [3, 4], 3),
      decided(1, 3, [5, 6], 5),
      decided(1, 4, [7, 8], 8),
      decided(2, 1, [1, 8], 8),
      decided(2, 2, [3, 5], 3),
    ]);

    expect(planNext(record)).toEqual({
      kind: 'schedule',
      round: 3,
      nodes: [{ round: 3, position: 1, participants: [3, 8] }],
      dropped: [],
    });
  });

  test('決勝の勝者が確定すれば、その勝者を優勝として終える', () => {
    const record = recordOf(2, [decided(1, 1, [1, 2], 2)]);

    expect(planNext(record)).toEqual({
      kind: 'finish',
      championNo: 2,
      dropped: [],
    });
  });

  test('決勝が両者敗北なら受賞なしで終える', () => {
    const record = recordOf(2, [decided(1, 1, [1, 2], null)]);

    expect(planNext(record)).toEqual({
      kind: 'finish',
      championNo: null,
      dropped: [],
    });
  });

  test('隣の位置が両者敗北で次ラウンドに残る参加者が1になれば、そのラウンドを行わずに優勝で終える', () => {
    const record = recordOf(4, [
      decided(1, 1, [1, 2], 2),
      decided(1, 2, [3, 4], null),
    ]);

    expect(planNext(record)).toEqual({
      kind: 'finish',
      championNo: 2,
      dropped: [],
    });
  });
});

describe('planNext(紐付けを解除した参加者)', () => {
  test('側の一方の紐付けが解除されていれば他方だけの側1つの位置にし、解除した参加者をそのラウンドの敗退にする', () => {
    expect(planNext(recordOf(4, [], [2]))).toEqual({
      kind: 'schedule',
      round: 1,
      nodes: [
        { round: 1, position: 1, participants: [1] },
        { round: 1, position: 2, participants: [3, 4] },
      ],
      dropped: [{ participantNo: 2, round: 1 }],
    });
  });

  test('両方の側の紐付けが解除された位置は作らない', () => {
    expect(planNext(recordOf(6, [], [3, 4]))).toEqual({
      kind: 'schedule',
      round: 1,
      nodes: [{ round: 1, position: 2, participants: [5, 6] }],
      dropped: [
        { participantNo: 3, round: 1 },
        { participantNo: 4, round: 1 },
      ],
    });
  });

  test('1回戦でシードが2回戦で待つなら、残る側が1でも終えずに1回戦を予定する', () => {
    expect(planNext(recordOf(3, [], [3]))).toEqual({
      kind: 'schedule',
      round: 1,
      nodes: [{ round: 1, position: 1, participants: [2] }],
      dropped: [{ participantNo: 3, round: 1 }],
    });
  });

  test('シードが待たない1回戦で残る側が1になれば、その参加者を優勝として終える', () => {
    expect(planNext(recordOf(2, [], [1]))).toEqual({
      kind: 'finish',
      championNo: 2,
      dropped: [{ participantNo: 1, round: 1 }],
    });
  });

  test('シードが待たない1回戦で残る側が0になれば、受賞なしで終える', () => {
    expect(planNext(recordOf(2, [], [1, 2]))).toEqual({
      kind: 'finish',
      championNo: null,
      dropped: [
        { participantNo: 1, round: 1 },
        { participantNo: 2, round: 1 },
      ],
    });
  });

  test('ラウンドの全ての位置が消えれば、全ての位置を両者敗北とみなして次のラウンドを決め直す', () => {
    expect(planNext(recordOf(5, [], [4, 5]))).toEqual({
      kind: 'schedule',
      round: 2,
      nodes: [
        { round: 2, position: 1, participants: [1] },
        { round: 2, position: 2, participants: [2, 3] },
      ],
      dropped: [
        { participantNo: 4, round: 1 },
        { participantNo: 5, round: 1 },
      ],
    });
  });

  test('1回戦を飛ばしてシードだけが残れば、そのシードを優勝として終える', () => {
    expect(planNext(recordOf(3, [], [2, 3]))).toEqual({
      kind: 'finish',
      championNo: 1,
      dropped: [
        { participantNo: 2, round: 1 },
        { participantNo: 3, round: 1 },
      ],
    });
  });

  test('1回戦を飛ばして残ったシードの紐付けも解除されていれば、受賞なしにしてそのシードを2回戦の敗退にする', () => {
    expect(planNext(recordOf(3, [], [1, 2, 3]))).toEqual({
      kind: 'finish',
      championNo: null,
      dropped: [
        { participantNo: 2, round: 1 },
        { participantNo: 3, round: 1 },
        { participantNo: 1, round: 2 },
      ],
    });
  });

  test('参加1の参加者の紐付けが解除されていれば、受賞なしにして1回戦の敗退にする', () => {
    expect(planNext(recordOf(1, [], [1]))).toEqual({
      kind: 'finish',
      championNo: null,
      dropped: [{ participantNo: 1, round: 1 }],
    });
  });

  test('次ラウンドの側から紐付けを解除した参加者を除いて残りが1になれば、優勝で終える', () => {
    const record = recordOf(
      4,
      [decided(1, 1, [1, 2], 1), decided(1, 2, [3, 4], 3)],
      [3],
    );

    expect(planNext(record)).toEqual({
      kind: 'finish',
      championNo: 1,
      dropped: [{ participantNo: 3, round: 2 }],
    });
  });

  test('決勝を待たずに勝ち残りが1になって終えるとき、その参加者の紐付けが解除されていれば受賞なしにして次のラウンドの敗退にする', () => {
    const record = recordOf(
      4,
      [decided(1, 1, [1, 2], 2), decided(1, 2, [3, 4], null)],
      [2],
    );

    expect(planNext(record)).toEqual({
      kind: 'finish',
      championNo: null,
      dropped: [{ participantNo: 2, round: 2 }],
    });
  });

  test('決勝のマッチで確定した勝者は、確定の後に紐付けが解除されても優勝のままにする', () => {
    const record = recordOf(
      4,
      [
        decided(1, 1, [1, 2], 1),
        decided(1, 2, [3, 4], 4),
        decided(2, 1, [1, 4], 4),
      ],
      [4],
    );

    expect(planNext(record)).toEqual({
      kind: 'finish',
      championNo: 4,
      dropped: [],
    });
  });

  test('決勝の前のラウンドで勝った参加者は決勝の勝者として扱わず、紐付けの解除で次のラウンドの敗退にする', () => {
    const record = recordOf(
      8,
      [
        decided(1, 1, [1, 2], 1),
        decided(1, 2, [3, 4], 3),
        decided(1, 3, [5, 6], 5),
        decided(1, 4, [7, 8], 7),
        decided(2, 1, [1, 7], 1),
        decided(2, 2, [3, 5], null),
      ],
      [1],
    );

    expect(planNext(record)).toEqual({
      kind: 'finish',
      championNo: null,
      dropped: [{ participantNo: 1, round: 3 }],
    });
  });
});
