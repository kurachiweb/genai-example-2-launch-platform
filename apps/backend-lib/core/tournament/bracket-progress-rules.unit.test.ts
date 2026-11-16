import { describe, expect, test } from 'bun:test';

import {
  type BracketState,
  decideNext,
  nextRoundOccupants,
  type PlannedNode,
  type RecordedNode,
} from './bracket-progress-rules.ts';
import { bracketShape } from './bracket-shape.ts';

// Weekトーナメント規則のN = 13の例の抽選番号(シードA・C・Dが1〜3、非シードがE〜Mの順で4〜13)
const A = 1;
const C = 2;
const D = 3;
const E = 4;
const F = 5;
const G = 6;
const H = 7;
const I = 8;
const B = 9;
const J = 10;
const K = 11;
const L = 12;
const M = 13;

type Outcome = RecordedNode['outcome'];

const NO_WINNER: Outcome = { kind: 'none' };

function winner(participantNo: number): Outcome {
  return { kind: 'winner', participantNo };
}

function recorded(
  { round, position, participants }: PlannedNode,
  outcome: Outcome,
): RecordedNode {
  return { round, position, participants, outcome };
}

function stateOf(
  participantCount: number,
  nodes: readonly RecordedNode[],
): BracketState {
  return { shape: bracketShape(participantCount), nodes };
}

function scheduledNodes(state: BracketState): readonly PlannedNode[] {
  const decision = decideNext(state);
  if (decision.kind !== 'schedule') {
    throw new Error(`scheduleではありません: ${decision.kind}`);
  }
  return decision.nodes;
}

function recordAll(
  nodes: readonly PlannedNode[],
  outcomes: readonly Outcome[],
): readonly RecordedNode[] {
  return nodes.map((node, index) => recorded(node, outcomes[index] ?? null));
}

const N13_FIRST_ROUND: readonly PlannedNode[] = [
  { round: 1, position: 1, participants: [E, F] },
  { round: 1, position: 2, participants: [G, H] },
  { round: 1, position: 3, participants: [I, B] },
  { round: 1, position: 4, participants: [J, K] },
  { round: 1, position: 5, participants: [L, M] },
];

const N13_FIRST_ROUND_RESULTS = recordAll(N13_FIRST_ROUND, [
  winner(E),
  winner(H),
  winner(B),
  winner(J),
  winner(L),
]);

describe('decideNext: 記録が無いとき', () => {
  test('参加0はマッチを作らずに受賞なしで終える', () => {
    expect(decideNext(stateOf(0, []))).toEqual({
      kind: 'finish',
      championNo: null,
    });
  });

  test('参加1はマッチを作らずにその参加者の優勝で終える', () => {
    expect(decideNext(stateOf(1, []))).toEqual({
      kind: 'finish',
      championNo: 1,
    });
  });

  test('参加2は1回戦として決勝だけを作る', () => {
    const state = stateOf(2, []);
    expect(state.shape.roundCount).toBe(1);
    expect(decideNext(state)).toEqual({
      kind: 'schedule',
      round: 1,
      nodes: [{ round: 1, position: 1, participants: [1, 2] }],
    });
  });

  test('参加3はシードを除いた2番と3番の1回戦を作る', () => {
    expect(decideNext(stateOf(3, []))).toEqual({
      kind: 'schedule',
      round: 1,
      nodes: [{ round: 1, position: 1, participants: [2, 3] }],
    });
  });

  test('参加13はk番の位置にS+2k−1番とS+2k番を置き、規則の例のE×F・G×H・I×B・J×K・L×Mになる', () => {
    expect(decideNext(stateOf(13, []))).toEqual({
      kind: 'schedule',
      round: 1,
      nodes: N13_FIRST_ROUND,
    });
  });
});

describe('decideNext: 未確定のマッチ', () => {
  test('現ラウンドに未確定のマッチが1つでもあれば待つ', () => {
    const nodes = recordAll(N13_FIRST_ROUND, [
      winner(E),
      winner(H),
      null,
      winner(J),
      winner(L),
    ]);
    expect(decideNext(stateOf(13, nodes))).toEqual({ kind: 'wait' });
  });

  test('決勝が未確定なら待つ', () => {
    const nodes = [
      recorded({ round: 1, position: 1, participants: [1, 2] }, null),
    ];
    expect(decideNext(stateOf(2, nodes))).toEqual({ kind: 'wait' });
  });
});

describe('decideNext: 2回戦の枠の配置', () => {
  test('参加13の準々決勝はA×M5勝者・M1勝者×M2勝者・C×M4勝者・D×M3勝者になる', () => {
    expect(decideNext(stateOf(13, N13_FIRST_ROUND_RESULTS))).toEqual({
      kind: 'schedule',
      round: 2,
      nodes: [
        { round: 2, position: 1, participants: [A, L] },
        { round: 2, position: 2, participants: [E, H] },
        { round: 2, position: 3, participants: [C, J] },
        { round: 2, position: 4, participants: [D, B] },
      ],
    });
  });

  test('参加3の2回戦は第1シードと1回戦の勝者の決勝になる', () => {
    const nodes = [
      recorded({ round: 1, position: 1, participants: [2, 3] }, winner(3)),
    ];
    expect(decideNext(stateOf(3, nodes))).toEqual({
      kind: 'schedule',
      round: 2,
      nodes: [{ round: 2, position: 1, participants: [1, 3] }],
    });
  });

  test('シードが無い参加8の2回戦も番号の並べ替えの列で組む', () => {
    const firstRound = scheduledNodes(stateOf(8, []));
    const nodes = recordAll(firstRound, [
      winner(1),
      winner(4),
      winner(5),
      winner(8),
    ]);
    expect(scheduledNodes(stateOf(8, nodes))).toEqual([
      { round: 2, position: 1, participants: [1, 8] },
      { round: 2, position: 2, participants: [4, 5] },
    ]);
  });
});

describe('decideNext: 3回戦以降の固定のブラケット', () => {
  test('準決勝は準々決勝の隣り合う2マッチの勝者同士を組む', () => {
    const quarterFinals = recordAll(
      scheduledNodes(stateOf(13, N13_FIRST_ROUND_RESULTS)),
      [winner(L), winner(E), winner(J), winner(D)],
    );
    expect(
      decideNext(stateOf(13, [...N13_FIRST_ROUND_RESULTS, ...quarterFinals])),
    ).toEqual({
      kind: 'schedule',
      round: 3,
      nodes: [
        { round: 3, position: 1, participants: [L, E] },
        { round: 3, position: 2, participants: [J, D] },
      ],
    });
  });

  test('決勝は準決勝の2マッチの勝者同士を組む', () => {
    const quarterFinals = recordAll(
      scheduledNodes(stateOf(13, N13_FIRST_ROUND_RESULTS)),
      [winner(A), winner(H), winner(C), winner(B)],
    );
    const semiFinals = recordAll(
      scheduledNodes(
        stateOf(13, [...N13_FIRST_ROUND_RESULTS, ...quarterFinals]),
      ),
      [winner(H), winner(C)],
    );
    expect(
      decideNext(
        stateOf(13, [
          ...N13_FIRST_ROUND_RESULTS,
          ...quarterFinals,
          ...semiFinals,
        ]),
      ),
    ).toEqual({
      kind: 'schedule',
      round: 4,
      nodes: [{ round: 4, position: 1, participants: [H, C] }],
    });
  });
});

describe('decideNext: 不戦勝の伝播', () => {
  test('1回戦M4が両者敗北ならCは準々決勝で側1つのマッチになる', () => {
    const firstRound = recordAll(N13_FIRST_ROUND, [
      winner(E),
      winner(H),
      winner(B),
      NO_WINNER,
      winner(L),
    ]);
    expect(scheduledNodes(stateOf(13, firstRound))).toEqual([
      { round: 2, position: 1, participants: [A, L] },
      { round: 2, position: 2, participants: [E, H] },
      { round: 2, position: 3, participants: [C] },
      { round: 2, position: 4, participants: [D, B] },
    ]);
  });

  test('さらに準々決勝M9も両者敗北ならCは準決勝でも続けて側1つのマッチになり、決勝で相手と当たる', () => {
    const firstRound = recordAll(N13_FIRST_ROUND, [
      winner(E),
      winner(H),
      winner(B),
      NO_WINNER,
      winner(L),
    ]);
    const quarterFinals = recordAll(scheduledNodes(stateOf(13, firstRound)), [
      winner(A),
      winner(E),
      winner(C),
      NO_WINNER,
    ]);
    const semiFinalState = stateOf(13, [...firstRound, ...quarterFinals]);
    expect(scheduledNodes(semiFinalState)).toEqual([
      { round: 3, position: 1, participants: [A, E] },
      { round: 3, position: 2, participants: [C] },
    ]);

    const semiFinals = recordAll(scheduledNodes(semiFinalState), [
      winner(E),
      winner(C),
    ]);
    expect(
      decideNext(stateOf(13, [...firstRound, ...quarterFinals, ...semiFinals])),
    ).toEqual({
      kind: 'schedule',
      round: 4,
      nodes: [{ round: 4, position: 1, participants: [E, C] }],
    });
  });

  test('両側が空の枠のマッチは作らず、その位置の勝者を空として次ラウンドへ伝える', () => {
    const firstRound = recordAll(N13_FIRST_ROUND, [
      NO_WINNER,
      NO_WINNER,
      winner(B),
      winner(J),
      winner(L),
    ]);
    const quarterFinals = scheduledNodes(stateOf(13, firstRound));
    expect(quarterFinals).toEqual([
      { round: 2, position: 1, participants: [A, L] },
      { round: 2, position: 3, participants: [C, J] },
      { round: 2, position: 4, participants: [D, B] },
    ]);

    const recordedQuarterFinals = recordAll(quarterFinals, [
      winner(L),
      winner(C),
      winner(B),
    ]);
    expect(
      scheduledNodes(stateOf(13, [...firstRound, ...recordedQuarterFinals])),
    ).toEqual([
      { round: 3, position: 1, participants: [L] },
      { round: 3, position: 2, participants: [C, B] },
    ]);
  });

  test('1回戦が全て両者敗北でもシードが残れば2回戦をシードだけで組む', () => {
    const firstRound = recordAll(
      N13_FIRST_ROUND,
      N13_FIRST_ROUND.map(() => NO_WINNER),
    );
    expect(scheduledNodes(stateOf(13, firstRound))).toEqual([
      { round: 2, position: 1, participants: [A] },
      { round: 2, position: 3, participants: [C] },
      { round: 2, position: 4, participants: [D] },
    ]);
  });
});

describe('decideNext: 終了', () => {
  test('次ラウンドに残るのが1人ならその参加者の優勝で終える', () => {
    const nodes = [
      recorded({ round: 1, position: 1, participants: [2, 3] }, NO_WINNER),
    ];
    expect(decideNext(stateOf(3, nodes))).toEqual({
      kind: 'finish',
      championNo: 1,
    });
  });

  test('準々決勝の後に残るのが1人なら決勝を待たずにその参加者の優勝で終える', () => {
    const quarterFinals = recordAll(
      scheduledNodes(stateOf(13, N13_FIRST_ROUND_RESULTS)),
      [NO_WINNER, NO_WINNER, winner(J), NO_WINNER],
    );
    expect(
      decideNext(stateOf(13, [...N13_FIRST_ROUND_RESULTS, ...quarterFinals])),
    ).toEqual({ kind: 'finish', championNo: J });
  });

  test('次ラウンドに残るのが0人なら受賞なしで終える', () => {
    const firstRound = recordAll(scheduledNodes(stateOf(4, [])), [
      NO_WINNER,
      NO_WINNER,
    ]);
    expect(decideNext(stateOf(4, firstRound))).toEqual({
      kind: 'finish',
      championNo: null,
    });
  });

  test('同じラウンドの全マッチが両者敗北なら受賞なしで終える', () => {
    const quarterFinals = recordAll(
      scheduledNodes(stateOf(13, N13_FIRST_ROUND_RESULTS)),
      [NO_WINNER, NO_WINNER, NO_WINNER, NO_WINNER],
    );
    expect(
      decideNext(stateOf(13, [...N13_FIRST_ROUND_RESULTS, ...quarterFinals])),
    ).toEqual({ kind: 'finish', championNo: null });
  });

  test('決勝の勝者の優勝で終える', () => {
    const nodes = [
      ...N13_FIRST_ROUND_RESULTS,
      recorded({ round: 2, position: 1, participants: [A, L] }, winner(A)),
      recorded({ round: 2, position: 2, participants: [E, H] }, winner(H)),
      recorded({ round: 2, position: 3, participants: [C, J] }, winner(C)),
      recorded({ round: 2, position: 4, participants: [D, B] }, winner(B)),
      recorded({ round: 3, position: 1, participants: [A, H] }, winner(H)),
      recorded({ round: 3, position: 2, participants: [C, B] }, winner(B)),
      recorded({ round: 4, position: 1, participants: [H, B] }, winner(B)),
    ];
    expect(decideNext(stateOf(13, nodes))).toEqual({
      kind: 'finish',
      championNo: B,
    });
  });

  test('決勝が両者敗北なら受賞なしで終える', () => {
    const nodes = [
      recorded({ round: 1, position: 1, participants: [2, 3] }, winner(2)),
      recorded({ round: 2, position: 1, participants: [1, 2] }, NO_WINNER),
    ];
    expect(decideNext(stateOf(3, nodes))).toEqual({
      kind: 'finish',
      championNo: null,
    });
  });

  test('参加2は決勝の勝者の優勝で終える', () => {
    const nodes = [
      recorded({ round: 1, position: 1, participants: [1, 2] }, winner(2)),
    ];
    expect(decideNext(stateOf(2, nodes))).toEqual({
      kind: 'finish',
      championNo: 2,
    });
  });

  test('参加2の決勝が両者敗北なら受賞なしで終える', () => {
    const nodes = [
      recorded({ round: 1, position: 1, participants: [1, 2] }, NO_WINNER),
    ];
    expect(decideNext(stateOf(2, nodes))).toEqual({
      kind: 'finish',
      championNo: null,
    });
  });
});

describe('decideNext: 入力の検査', () => {
  test('勝者がそのマッチの参加者でなければ例外になる', () => {
    const nodes = [
      recorded({ round: 1, position: 1, participants: [2, 3] }, winner(1)),
    ];
    expect(() => decideNext(stateOf(3, nodes))).toThrow(RangeError);
  });

  test('最終ラウンドより後のラウンドの記録があれば例外になる', () => {
    const nodes = [
      recorded({ round: 1, position: 1, participants: [1, 2] }, winner(1)),
      recorded({ round: 2, position: 1, participants: [1] }, winner(1)),
    ];
    expect(() => decideNext(stateOf(2, nodes))).toThrow(RangeError);
  });

  test('同じ入力からは常に同じ判定を返し、記録の並びに依存しない', () => {
    const state = stateOf(13, N13_FIRST_ROUND_RESULTS);
    const reversed = stateOf(13, [...N13_FIRST_ROUND_RESULTS].reverse());
    expect(decideNext(state)).toEqual(decideNext(state));
    expect(decideNext(reversed)).toEqual(decideNext(state));
  });
});

describe('nextRoundOccupants', () => {
  test('1回戦の後は、シードをシード順に1〜S番、1回戦の勝者をマッチの番号順にS+1〜P番に置く', () => {
    expect([
      ...nextRoundOccupants(stateOf(13, N13_FIRST_ROUND_RESULTS), 1),
    ]).toEqual([
      [1, A],
      [2, C],
      [3, D],
      [4, E],
      [5, H],
      [6, B],
      [7, J],
      [8, L],
    ]);
  });

  test('勝者のいないマッチと作らなかったマッチの枠は空にする', () => {
    const firstRound = recordAll(N13_FIRST_ROUND, [
      NO_WINNER,
      NO_WINNER,
      winner(B),
      winner(J),
      winner(L),
    ]);
    const quarterFinals = recordAll(scheduledNodes(stateOf(13, firstRound)), [
      winner(A),
      winner(C),
      NO_WINNER,
    ]);
    expect([
      ...nextRoundOccupants(stateOf(13, [...firstRound, ...quarterFinals]), 2),
    ]).toEqual([
      [1, A],
      [2, null],
      [3, C],
      [4, null],
    ]);
  });

  test('未確定のマッチの枠は空にする', () => {
    const firstRound = recordAll(N13_FIRST_ROUND, [
      winner(F),
      null,
      winner(I),
      winner(K),
      winner(M),
    ]);
    expect(nextRoundOccupants(stateOf(13, firstRound), 1).get(5)).toBeNull();
  });

  test.each([0, 4, 1.5])(
    '次ラウンドの無いラウンド%pを指定すると例外になる',
    (round) => {
      expect(() =>
        nextRoundOccupants(stateOf(13, N13_FIRST_ROUND_RESULTS), round),
      ).toThrow(RangeError);
    },
  );
});
