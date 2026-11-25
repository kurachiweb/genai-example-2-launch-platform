import type { Logger } from '@logtape/logtape';

import type {
  MatchEntryView,
  MatchView,
} from '../../../../application/match/match-view-reader.ts';
import {
  type ByeReason,
  type Placement,
  placementOf,
} from '../../../../domain/match/board-order.ts';
import type { GraphQLContext } from '../../graphql-context.ts';
import type { MatchByeModel } from '../match/mappers.ts';
import { loadMatchView } from '../match/match-views.ts';

export interface TournamentRoundBoardSource {
  // ブラケットの位置の順
  readonly matchIds: readonly string[];
}

export interface UnplaceableMatchLog {
  readonly logger: Logger;
  readonly message: string;
}

export interface TournamentRoundBoardFieldResolvers {
  readonly matches: (
    row: TournamentRoundBoardSource,
    args: unknown,
    context: GraphQLContext,
  ) => Promise<MatchView[]>;
  readonly byes: (
    row: TournamentRoundBoardSource,
    args: unknown,
    context: GraphQLContext,
  ) => Promise<MatchByeModel[]>;
}

interface PlacedMatch {
  readonly view: MatchView;
  readonly placement: Placement;
}

const BYE_REASON_VALUES = Object.freeze({
  absent: 'ABSENT',
  forfeit: 'FORFEIT',
  early: 'EARLY',
} as const satisfies Record<ByeReason, MatchByeModel['reason']>);

// 不整合な1件でトップページの区画全体をエラーにしないため、置き場所を決められないマッチは除く
function placementOfView(
  view: MatchView,
  unplaceable: UnplaceableMatchLog,
): Placement | undefined {
  const { record } = view;
  try {
    return placementOf({
      matchId: record.matchId,
      totalUpvotes: record.entries.reduce(
        (total, entry) => total + entry.upvoteCount,
        0,
      ),
      decision: record.decision,
      endedEarly: record.endedEarly,
      entryCount: record.entries.length === 1 ? 1 : 2,
    });
  } catch (error) {
    if (!(error instanceof RangeError)) {
      throw error;
    }
    unplaceable.logger.warn(unplaceable.message, { matchId: record.matchId });
    return undefined;
  }
}

// 行ごとに引いても、同じ要求の一括読み込みが全ての行のマッチを1回の照会にまとめ、対戦カードと不戦勝の項目で結果を使い回す
async function placedMatchesOf(
  row: TournamentRoundBoardSource,
  context: GraphQLContext,
  unplaceable: UnplaceableMatchLog,
): Promise<readonly PlacedMatch[]> {
  const views = await Promise.all(
    row.matchIds.map((matchId) => loadMatchView(context, matchId)),
  );
  return views.flatMap((view) => {
    const placement =
      view === null ? undefined : placementOfView(view, unplaceable);
    return view === null || placement === undefined
      ? []
      : [{ view, placement }];
  });
}

// 開始の記録の前の側が1つのマッチは、結果の前でも唯一の側が勝ち上がる
function byeEntryOf(view: MatchView): MatchEntryView | undefined {
  return (
    view.entries.find(
      (entry) => entry.result === 'bye' || entry.result === 'walkover',
    ) ?? (view.entries.length === 1 ? view.entries[0] : undefined)
  );
}

function toBye({ view, placement }: PlacedMatch): MatchByeModel[] {
  if (placement.kind !== 'bye') {
    return [];
  }
  const entry = byeEntryOf(view);
  return entry === undefined
    ? []
    : [{ match: view, entry, reason: BYE_REASON_VALUES[placement.reason] }];
}

// トーナメントの種類ごとのラウンドの区画の型の、対戦カードと不戦勝の項目のリゾルバ
export function tournamentRoundBoardFieldResolvers(
  unplaceable: UnplaceableMatchLog,
): TournamentRoundBoardFieldResolvers {
  return {
    matches: async (row, _args, context) =>
      (await placedMatchesOf(row, context, unplaceable)).flatMap(
        ({ view, placement }) => (placement.kind === 'card' ? [view] : []),
      ),
    byes: async (row, _args, context) =>
      (await placedMatchesOf(row, context, unplaceable)).flatMap(toBye),
  };
}
