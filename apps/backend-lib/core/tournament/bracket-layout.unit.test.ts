import { describe, expect, test } from 'bun:test';

import {
  bracketLayout,
  type LayoutNode,
  type SlotFeed,
} from './bracket-layout.ts';
import {
  type BracketState,
  decideNext,
  type PlannedNode,
  type RecordedNode,
} from './bracket-progress-rules.ts';
import { bracketShape } from './bracket-shape.ts';

type Outcome = RecordedNode['outcome'];

function seed(participantNo: number): SlotFeed {
  return { kind: 'participant', participantNo };
}

function winnerOf(round: number, position: number): SlotFeed {
  return { kind: 'winner_of', round, position };
}

function layoutOf(participantCount: number): readonly LayoutNode[] {
  return bracketLayout(bracketShape(participantCount));
}

function nodeAt(
  layout: readonly LayoutNode[],
  round: number,
  position: number,
): LayoutNode | undefined {
  return layout.find(
    (node) => node.round === round && node.position === position,
  );
}

function positionCountsByRound(
  layout: readonly LayoutNode[],
): readonly number[] {
  const roundCount = Math.max(0, ...layout.map(({ round }) => round));
  return Array.from(
    { length: roundCount },
    (_, index) => layout.filter(({ round }) => round === index + 1).length,
  );
}

function lowerNumberWins(node: PlannedNode): Outcome {
  return { kind: 'winner', participantNo: Math.min(...node.participants) };
}

function feedOccupant(
  feed: SlotFeed,
  recorded: readonly RecordedNode[],
): number | null {
  if (feed.kind === 'participant') {
    return feed.participantNo;
  }
  const source = recorded.find(
    ({ round, position }) => round === feed.round && position === feed.position,
  );
  return source?.outcome?.kind === 'winner'
    ? source.outcome.participantNo
    : null;
}

// 表示の配置の枠を記録済みの勝者で埋め、空の側を除いて両側が空の位置を落とした対戦にする
function resolvedRound(
  layout: readonly LayoutNode[],
  round: number,
  recorded: readonly RecordedNode[],
): readonly PlannedNode[] {
  return layout
    .filter((node) => node.round === round)
    .flatMap(({ position, feeds }) => {
      const [first, second] = feeds
        .map((feed) => feedOccupant(feed, recorded))
        .filter((occupant): occupant is number => occupant !== null);
      if (first === undefined) {
        return [];
      }
      return [
        {
          round,
          position,
          participants: second === undefined ? [first] : [first, second],
        } satisfies PlannedNode,
      ];
    });
}

interface ProgressTrace {
  readonly roundsChecked: number;
  readonly championNo: number | null;
}

// decideNextで最後まで進め、予定を作るたびに表示の配置から求めた対戦と一致することを確かめる
function traceAgainstLayout(
  participantCount: number,
  decide: (node: PlannedNode) => Outcome,
): ProgressTrace {
  const shape = bracketShape(participantCount);
  const layout = bracketLayout(shape);
  let recorded: readonly RecordedNode[] = [];
  let roundsChecked = 0;
  for (;;) {
    const state: BracketState = { shape, nodes: recorded };
    const decision = decideNext(state);
    if (decision.kind === 'finish') {
      return { roundsChecked, championNo: decision.championNo };
    }
    if (decision.kind === 'wait') {
      throw new Error('全てのマッチを確定させたのに待ちになりました');
    }
    expect(decision.nodes).toEqual(
      resolvedRound(layout, decision.round, recorded),
    );
    roundsChecked += 1;
    recorded = [
      ...recorded,
      ...decision.nodes.map((node) => ({ ...node, outcome: decide(node) })),
    ];
  }
}

describe('bracketLayout: 参加が2未満', () => {
  test.each([0, 1])('参加%iはマッチの位置を持たない', (participantCount) => {
    expect(layoutOf(participantCount)).toEqual([]);
  });
});

describe('bracketLayout: 参加13(Weekトーナメント規則の例)', () => {
  test('全ラウンドの位置と、各枠がシードの番号か前ラウンドの位置の勝者かを表す', () => {
    expect(layoutOf(13)).toEqual([
      { round: 1, position: 1, feeds: [seed(4), seed(5)] },
      { round: 1, position: 2, feeds: [seed(6), seed(7)] },
      { round: 1, position: 3, feeds: [seed(8), seed(9)] },
      { round: 1, position: 4, feeds: [seed(10), seed(11)] },
      { round: 1, position: 5, feeds: [seed(12), seed(13)] },
      { round: 2, position: 1, feeds: [seed(1), winnerOf(1, 5)] },
      { round: 2, position: 2, feeds: [winnerOf(1, 1), winnerOf(1, 2)] },
      { round: 2, position: 3, feeds: [seed(2), winnerOf(1, 4)] },
      { round: 2, position: 4, feeds: [seed(3), winnerOf(1, 3)] },
      { round: 3, position: 1, feeds: [winnerOf(2, 1), winnerOf(2, 2)] },
      { round: 3, position: 2, feeds: [winnerOf(2, 3), winnerOf(2, 4)] },
      { round: 4, position: 1, feeds: [winnerOf(3, 1), winnerOf(3, 2)] },
    ]);
  });
});

describe('bracketLayout: 参加129', () => {
  const layout = layoutOf(129);

  test('各ラウンドの位置の数は1・64・32・16・8・4・2・1である', () => {
    expect(positionCountsByRound(layout)).toEqual([1, 64, 32, 16, 8, 4, 2, 1]);
  });

  test('1回戦は128番と129番の1マッチだけで、その勝者が2回戦の位置1で第1シードと当たる', () => {
    expect(nodeAt(layout, 1, 1)?.feeds).toEqual([seed(128), seed(129)]);
    expect(nodeAt(layout, 2, 1)?.feeds).toEqual([seed(1), winnerOf(1, 1)]);
  });

  test('2回戦の位置1以外はシード同士が番号の並べ替えの列で当たる', () => {
    expect(nodeAt(layout, 2, 2)?.feeds).toEqual([seed(64), seed(65)]);
    expect(nodeAt(layout, 2, 64)?.feeds).toEqual([seed(43), seed(86)]);
  });

  test('3回戦以降は前ラウンドの隣り合う2つの位置の勝者を受ける', () => {
    expect(nodeAt(layout, 3, 32)?.feeds).toEqual([
      winnerOf(2, 63),
      winnerOf(2, 64),
    ]);
    expect(nodeAt(layout, 8, 1)?.feeds).toEqual([
      winnerOf(7, 1),
      winnerOf(7, 2),
    ]);
  });
});

describe('bracketLayout: 参加200', () => {
  const layout = layoutOf(200);

  test('各ラウンドの位置の数は72・64・32・16・8・4・2・1である', () => {
    expect(positionCountsByRound(layout)).toEqual([72, 64, 32, 16, 8, 4, 2, 1]);
  });

  test('1回戦はシード56人を除いた57番〜200番を2人ずつ組む', () => {
    expect(nodeAt(layout, 1, 1)?.feeds).toEqual([seed(57), seed(58)]);
    expect(nodeAt(layout, 1, 72)?.feeds).toEqual([seed(199), seed(200)]);
  });

  test('2回戦の枠はシードの番号か1回戦の位置の勝者を表す', () => {
    expect(nodeAt(layout, 2, 1)?.feeds).toEqual([seed(1), winnerOf(1, 72)]);
    expect(nodeAt(layout, 2, 2)?.feeds).toEqual([
      winnerOf(1, 8),
      winnerOf(1, 9),
    ]);
  });

  test('決勝は準決勝の2つの位置の勝者を受ける', () => {
    expect(nodeAt(layout, 8, 1)?.feeds).toEqual([
      winnerOf(7, 1),
      winnerOf(7, 2),
    ]);
  });
});

describe('bracketLayout: 配置の形', () => {
  test.each([2, 3, 8, 13, 129, 200])(
    '参加%iでは、ラウンドと位置の昇順に並び、各番号が1回だけ枠に現れ、決勝以外の各位置の勝者が次ラウンドの1つの枠だけに入る',
    (participantCount) => {
      const shape = bracketShape(participantCount);
      const layout = bracketLayout(shape);

      const order = layout.map(({ round, position }) => [round, position]);
      expect(order).toEqual(
        [...order].sort(([ra = 0, pa = 0], [rb = 0, pb = 0]) =>
          ra === rb ? pa - pb : ra - rb,
        ),
      );

      const feeds = layout.flatMap((node) =>
        node.feeds.map((feed) => ({ node, feed })),
      );
      const participantNos = feeds.flatMap(({ feed }) =>
        feed.kind === 'participant' ? [feed.participantNo] : [],
      );
      expect([...participantNos].sort((a, b) => a - b)).toEqual(
        Array.from({ length: participantCount }, (_, index) => index + 1),
      );

      const references = feeds.flatMap(({ node, feed }) =>
        feed.kind === 'winner_of' ? [{ node, feed }] : [],
      );
      for (const { node, feed } of references) {
        expect(feed.round).toBe(node.round - 1);
        expect(nodeAt(layout, feed.round, feed.position)).toBeDefined();
      }
      const referencedKeys = references.map(
        ({ feed }) => `${String(feed.round)}-${String(feed.position)}`,
      );
      expect(new Set(referencedKeys).size).toBe(referencedKeys.length);
      expect(referencedKeys).toHaveLength(layout.length - 1);
      expect(nodeAt(layout, shape.roundCount, 1)).toBeDefined();
    },
  );
});

describe('bracketLayout: decideNextの進行との一致', () => {
  test.each([
    [2, 1],
    [3, 2],
    [8, 3],
    [13, 4],
    [129, 8],
    [200, 8],
  ])(
    '参加%iで番号の小さい側が勝ち進むと、%iラウンドの全ての予定が表示の配置と同じ対戦になる',
    (participantCount, roundCount) => {
      expect(traceAgainstLayout(participantCount, lowerNumberWins)).toEqual({
        roundsChecked: roundCount,
        championNo: 1,
      });
    },
  );

  test('参加13で1回戦M4と準々決勝M9が両者敗北でも、側1つのマッチと除かれる位置が表示の配置から求めた対戦と一致する', () => {
    const DOUBLE_DEFEATS = new Set(['1-4', '2-4']);
    const trace = traceAgainstLayout(13, (node) =>
      DOUBLE_DEFEATS.has(`${String(node.round)}-${String(node.position)}`)
        ? { kind: 'none' }
        : lowerNumberWins(node),
    );
    expect(trace).toEqual({ roundsChecked: 4, championNo: 1 });
  });

  test('参加200で1回戦の全てが両者敗北でも、シードだけの2回戦が表示の配置から求めた対戦と一致する', () => {
    const trace = traceAgainstLayout(200, (node) =>
      node.round === 1 ? { kind: 'none' } : lowerNumberWins(node),
    );
    expect(trace).toEqual({ roundsChecked: 8, championNo: 1 });
  });
});
