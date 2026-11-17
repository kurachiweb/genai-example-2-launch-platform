import {
  type BracketState,
  decideNext,
  type PlannedNode,
  type RecordedNode,
} from './bracket-progress-rules.ts';
import type { BracketMatchRecord, BracketRecord } from './ports.ts';

export interface Elimination {
  readonly participantNo: number;
  readonly round: number;
}

export interface SchedulePlan {
  readonly kind: 'schedule';
  readonly round: number;
  readonly nodes: readonly PlannedNode[];
  readonly dropped: readonly Elimination[];
}

export type ProgressPlan =
  | { readonly kind: 'wait' }
  | SchedulePlan
  | {
      readonly kind: 'finish';
      readonly championNo: number | null;
      readonly dropped: readonly Elimination[];
    };

function outcomeOf(match: BracketMatchRecord): RecordedNode['outcome'] {
  if (match.status !== 'decided') {
    return null;
  }
  return match.winnerNo === null
    ? { kind: 'none' }
    : { kind: 'winner', participantNo: match.winnerNo };
}

// 位置の挿入の後で予定を作る前に中断したラウンドは、前ラウンドの結果から作り直して補う
function stateOf(record: BracketRecord): BracketState {
  const plannedRounds = record.matches
    .filter(({ status }) => status === 'planned')
    .map(({ round }) => round);
  const rebuildFrom = Math.min(...plannedRounds);
  return {
    shape: record.shape,
    nodes: record.matches
      .filter(({ round }) => round < rebuildFrom)
      .map((match) => ({
        round: match.round,
        position: match.position,
        participants: match.participantNos,
        outcome: outcomeOf(match),
      })),
  };
}

function linkedNosOf(record: BracketRecord): ReadonlySet<number> {
  return new Set(
    record.participants
      .filter(
        ({ launchId, productId, ownerUserId }) =>
          launchId !== null && productId !== null && ownerUserId !== null,
      )
      .map(({ participantNo }) => participantNo),
  );
}

function ascendingParticipants(
  participants: readonly number[],
): BracketMatchRecord['participantNos'] | undefined {
  const [first, second] = [...participants].sort((a, b) => a - b);
  if (first === undefined) {
    return undefined;
  }
  return second === undefined ? [first] : [first, second];
}

function withoutUnlinked(
  node: PlannedNode,
  linked: ReadonlySet<number>,
): PlannedNode | undefined {
  const participants = ascendingParticipants(
    node.participants.filter((no) => linked.has(no)),
  );
  return participants === undefined ? undefined : { ...node, participants };
}

// 1回戦にシードがあると、シードは1回戦の位置に入らず2回戦で待つ
function hasWaitingSeeds(record: BracketRecord, round: number): boolean {
  return round === 1 && record.shape.seedCount > 0;
}

function isFinalWinner(state: BracketState, participantNo: number): boolean {
  return state.nodes.some(
    ({ round, outcome }) =>
      round === state.shape.roundCount &&
      outcome?.kind === 'winner' &&
      outcome.participantNo === participantNo,
  );
}

// 決勝のマッチで勝った参加者は、その後に紐付けを解除しても優勝のままにする。勝ち残りが1になって終えるとき、残った参加者の紐付けが解除されていれば空の側と同じく受賞なしにし、次に戦うはずだったラウンドで敗退させる
function finishPlan(
  state: BracketState,
  championNo: number | null,
  linked: ReadonlySet<number>,
  dropped: readonly Elimination[],
): ProgressPlan {
  if (
    championNo === null ||
    linked.has(championNo) ||
    isFinalWinner(state, championNo)
  ) {
    return { kind: 'finish', championNo, dropped };
  }
  const round = Math.max(0, ...state.nodes.map((node) => node.round)) + 1;
  return {
    kind: 'finish',
    championNo: null,
    dropped: [...dropped, { participantNo: championNo, round }],
  };
}

// 紐付けを解除した参加者は空の側として扱う。位置が1つも残らないラウンドは、全ての位置を両者敗北として次を決め直す
export function planNext(record: BracketRecord): ProgressPlan {
  const linked = linkedNosOf(record);
  const dropped: Elimination[] = [];
  let state = stateOf(record);
  for (;;) {
    const decision = decideNext(state);
    if (decision.kind === 'wait') {
      return decision;
    }
    if (decision.kind === 'finish') {
      return finishPlan(state, decision.championNo, linked, dropped);
    }
    const { round } = decision;
    dropped.push(
      ...decision.nodes.flatMap(({ participants }) =>
        participants
          .filter((no) => !linked.has(no))
          .map((participantNo) => ({ participantNo, round })),
      ),
    );
    const nodes = decision.nodes.flatMap((node) => {
      const kept = withoutUnlinked(node, linked);
      return kept === undefined ? [] : [kept];
    });
    const remaining = nodes.flatMap(({ participants }) => participants);
    if (!hasWaitingSeeds(record, round) && remaining.length <= 1) {
      return { kind: 'finish', championNo: remaining[0] ?? null, dropped };
    }
    if (nodes.length > 0) {
      return { kind: 'schedule', round, nodes, dropped };
    }
    state = {
      shape: state.shape,
      nodes: [
        ...state.nodes,
        ...decision.nodes.map((node) => ({
          ...node,
          outcome: { kind: 'none' } as const,
        })),
      ],
    };
  }
}
