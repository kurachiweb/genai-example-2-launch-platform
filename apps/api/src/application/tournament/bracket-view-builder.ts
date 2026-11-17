import { tournamentRoundName } from '../../../common-lib/tournament/round-name.ts';
import type { EntryResult } from '../../../lib/core/match/match-model.ts';
import type { BusinessDate } from '../../../lib/core/time/business-time.ts';
import {
  bracketLayout,
  type LayoutNode,
  type SlotFeed,
} from '../../../lib/core/tournament/bracket-layout.ts';
import { roundSlotCount } from '../../../lib/core/tournament/bracket-shape.ts';
import type {
  BracketMatchRecord,
  BracketRecord,
} from '../../../lib/core/tournament/ports.ts';
import {
  dailyRoundPolicy,
  type RoundSchedulePolicy,
} from '../../../lib/core/tournament/round-schedule.ts';
import type {
  MatchProductView,
  MatchView,
} from '../match/match-view-reader.ts';

export interface BracketSlotView {
  // 未確定の枠はnull
  readonly participantNo: number | null;
  // シードなら抽選番号(1〜S)
  readonly seed: number | null;
  // 未来の枠の表記(「シード1」「1回戦第3試合の勝者」)
  readonly feedLabel: string | null;
  // 表示できない・未来の枠はnull
  readonly product: MatchProductView | null;
  readonly upvoteCount: number | null;
  readonly result: EntryResult | null;
}

export interface BracketNodeView {
  readonly position: number;
  // 予定を作っていない位置はnull
  readonly match: MatchView | null;
  readonly slots: readonly [BracketSlotView, BracketSlotView];
}

export interface BracketRoundView {
  readonly round: number;
  readonly name: string;
  readonly date: BusinessDate;
  // 位置の昇順。両側が空と確定した位置は含めない
  readonly nodes: readonly BracketNodeView[];
}

export interface BracketRoundsView {
  readonly participantCount: number;
  readonly seedCount: number;
  // ラウンドの昇順。参加0・1は空
  readonly rounds: readonly BracketRoundView[];
  readonly championNo: number | null;
}

export interface BracketRoundsViewInput {
  readonly record: BracketRecord;
  // 記録済みのマッチのID→表示
  readonly matchViews: ReadonlyMap<string, MatchView>;
  readonly now: Date;
}

type WinnerState =
  | { readonly kind: 'empty' }
  | { readonly kind: 'pending' }
  | { readonly kind: 'known'; readonly participantNo: number };

interface BuildContext {
  readonly record: BracketRecord;
  readonly matchViews: ReadonlyMap<string, MatchView>;
  readonly recorded: ReadonlyMap<string, BracketMatchRecord>;
  readonly winners: Map<string, WinnerState>;
}

const EMPTY: WinnerState = { kind: 'empty' };
const PENDING: WinnerState = { kind: 'pending' };

const EMPTY_SLOT: BracketSlotView = Object.freeze({
  participantNo: null,
  seed: null,
  feedLabel: null,
  product: null,
  upvoteCount: null,
  result: null,
});

const keyOf = (round: number, position: number): string =>
  `${String(round)}:${String(position)}`;

function roundNameOf(record: BracketRecord, round: number): string {
  return tournamentRoundName({
    round,
    slotCount: roundSlotCount(record.shape, round),
  });
}

function seedOf(record: BracketRecord, participantNo: number): number | null {
  return participantNo <= record.shape.seedCount ? participantNo : null;
}

// 予定を作り終えたラウンド(後のラウンドに記録があるか、予定の作成の途中でない)は、記録の無い位置を両側が空と確定した位置とみなす
function isSettledRound(record: BracketRecord, round: number): boolean {
  return record.matches.some(
    (match) =>
      match.round > round ||
      (match.round === round && match.status !== 'planned'),
  );
}

function isEmptySlot(slot: BracketSlotView): boolean {
  return slot.participantNo === null && slot.feedLabel === null;
}

function knownSlot(
  context: BuildContext,
  participantNo: number,
  feedLabel: string | null,
): BracketSlotView {
  return {
    ...EMPTY_SLOT,
    participantNo,
    seed: seedOf(context.record, participantNo),
    feedLabel,
  };
}

function feedSlot(context: BuildContext, feed: SlotFeed): BracketSlotView {
  if (feed.kind === 'participant') {
    const seed = seedOf(context.record, feed.participantNo);
    return knownSlot(
      context,
      feed.participantNo,
      seed === null ? null : `シード${String(seed)}`,
    );
  }
  const feedLabel = `${roundNameOf(context.record, feed.round)}第${String(feed.position)}試合の勝者`;
  const state = context.winners.get(keyOf(feed.round, feed.position)) ?? EMPTY;
  if (state.kind === 'empty') {
    return EMPTY_SLOT;
  }
  if (state.kind === 'known') {
    return knownSlot(context, state.participantNo, feedLabel);
  }
  return { ...EMPTY_SLOT, feedLabel };
}

function playedSlot(
  context: BuildContext,
  match: BracketMatchRecord,
  view: MatchView | undefined,
  side: number,
): BracketSlotView {
  const participantNo = match.participantNos[side];
  if (participantNo === undefined) {
    return EMPTY_SLOT;
  }
  const entry = view?.entries[side];
  return {
    ...knownSlot(context, participantNo, null),
    product: entry?.product ?? null,
    upvoteCount: entry?.upvoteCount ?? null,
    result: entry?.result ?? null,
  };
}

function winnerOfRecorded(match: BracketMatchRecord): WinnerState {
  if (match.status !== 'decided') {
    return PENDING;
  }
  return match.winnerNo === null
    ? EMPTY
    : { kind: 'known', participantNo: match.winnerNo };
}

// 紐付けを解除した参加者を除いて側を詰めるため、側の順ではなく抽選番号で配置の枠を選ぶ
function unscheduledSlot(
  context: BuildContext,
  layout: LayoutNode,
  match: BracketMatchRecord,
  side: number,
): BracketSlotView {
  const participantNo = match.participantNos[side];
  if (participantNo === undefined) {
    return EMPTY_SLOT;
  }
  return (
    layout.feeds
      .map((feed) => feedSlot(context, feed))
      .find((slot) => slot.participantNo === participantNo) ??
    knownSlot(context, participantNo, null)
  );
}

function recordedNode(
  context: BuildContext,
  layout: LayoutNode,
  match: BracketMatchRecord,
): BracketNodeView {
  const view = context.matchViews.get(match.matchId);
  context.winners.set(
    keyOf(match.round, match.position),
    winnerOfRecorded(match),
  );
  const slotAt = (side: number): BracketSlotView =>
    view === undefined && match.status === 'planned'
      ? unscheduledSlot(context, layout, match, side)
      : playedSlot(context, match, view, side);
  return {
    position: match.position,
    match: view ?? null,
    slots: [slotAt(0), slotAt(1)],
  };
}

function nodeOf(
  context: BuildContext,
  layout: LayoutNode,
  settled: boolean,
): BracketNodeView | undefined {
  const key = keyOf(layout.round, layout.position);
  const match = context.recorded.get(key);
  if (match !== undefined) {
    return recordedNode(context, layout, match);
  }
  const slots = [
    feedSlot(context, layout.feeds[0]),
    feedSlot(context, layout.feeds[1]),
  ] as const;
  const bothEmpty = slots.every(isEmptySlot);
  if (settled || bothEmpty) {
    context.winners.set(key, EMPTY);
    return undefined;
  }
  context.winners.set(key, PENDING);
  return { position: layout.position, match: null, slots };
}

function latestRecordedDate(
  record: BracketRecord,
  round: number,
): BusinessDate | undefined {
  return record.matches
    .filter((match) => match.round === round)
    .reduce<BusinessDate | undefined>(
      (latest, { matchDate }) =>
        latest === undefined || matchDate > latest ? matchDate : latest,
      undefined,
    );
}

function policyOf(record: BracketRecord, now: Date): RoundSchedulePolicy {
  if (record.firstRoundDate === null) {
    throw new RangeError(
      `ブラケット${record.bracketId}は1回戦の日が無いため、ラウンドの実施日を求められません`,
    );
  }
  return dailyRoundPolicy(record.firstRoundDate, now);
}

// 記録の無いラウンドは日次の進行の規則で前のラウンドの翌日(遅れの後は現在の業務日付の翌日以降)とする
function roundDates(
  record: BracketRecord,
  roundCount: number,
  now: Date,
): readonly BusinessDate[] {
  const dates: BusinessDate[] = [];
  for (let round = 1; round <= roundCount; round += 1) {
    const previous = dates.at(-1);
    dates.push(
      latestRecordedDate(record, round) ??
        (previous === undefined
          ? policyOf(record, now).firstRoundDate
          : policyOf(record, now).nextRoundDate(previous, now)),
    );
  }
  return dates;
}

// 終了したブラケットは、最後に記録したラウンドより後を表示しない
function visibleRoundCount(record: BracketRecord): number {
  if (record.status !== 'finished') {
    return record.shape.roundCount;
  }
  return Math.min(
    record.shape.roundCount,
    Math.max(0, ...record.matches.map(({ round }) => round)),
  );
}

function championNoOf(record: BracketRecord): number | null {
  if (record.outcome !== 'champion' || record.championRef === null) {
    return null;
  }
  return (
    record.participants.find(({ ref }) => ref === record.championRef)
      ?.participantNo ?? null
  );
}

export function buildBracketRoundsView({
  record,
  matchViews,
  now,
}: BracketRoundsViewInput): BracketRoundsView {
  const context: BuildContext = {
    record,
    matchViews,
    recorded: new Map(
      record.matches.map((match) => [
        keyOf(match.round, match.position),
        match,
      ]),
    ),
    winners: new Map(),
  };
  const roundCount = visibleRoundCount(record);
  const dates = roundDates(record, roundCount, now);
  const layout = bracketLayout(record.shape);
  const rounds = dates.flatMap((date, index): BracketRoundView[] => {
    const round = index + 1;
    const settled = isSettledRound(record, round);
    const nodes = layout
      .filter((node) => node.round === round)
      .flatMap((node) => nodeOf(context, node, settled) ?? []);
    return nodes.length === 0
      ? []
      : [{ round, name: roundNameOf(record, round), date, nodes }];
  });
  return {
    participantCount: record.shape.participantCount,
    seedCount: record.shape.seedCount,
    rounds,
    championNo: championNoOf(record),
  };
}
