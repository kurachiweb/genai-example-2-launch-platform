import { getAppLogger } from '../../../../../lib/core/logging/app-logger.ts';
import type {
  MatchEntryView,
  MatchView,
} from '../../../../application/match/match-view-reader.ts';
import type { YearBoardReader } from '../../../../application/year-tournament/year-board-reader.ts';
import { YEAR_TOURNAMENT_API_TYPES } from '../../../../application/year-tournament/year-tournament-api-types.ts';
import {
  type ByeReason,
  type Placement,
  placementOf,
} from '../../../../domain/match/board-order.ts';
import type { Resolvers } from '../../generated/resolvers-types.ts';
import type { GraphQLContext } from '../../graphql-context.ts';
import { withValidatedArgs } from '../../validated-args.ts';
import { type MatchByeModel } from '../match/mappers.ts';
import { loadMatchView } from '../match/match-views.ts';
import { YEAR_TOURNAMENT_BOARD_ARGS } from './inputs.ts';
import {
  toYearTournamentRoundBoard,
  type YearTournamentRoundBoardModel,
} from './mappers.ts';
import { clientOnly, clockOf } from './resolver-support.ts';

interface PlacedMatch {
  readonly view: MatchView;
  readonly placement: Placement;
}

const BYE_REASON_VALUES = Object.freeze({
  absent: 'ABSENT',
  forfeit: 'FORFEIT',
  early: 'EARLY',
} as const satisfies Record<ByeReason, MatchByeModel['reason']>);

const logger = getAppLogger(['api', 'presentation', 'year-tournament']);

// 不整合な1件でトップページの区画全体をエラーにしないため、置き場所を決められないマッチは除く
function placementOfView(view: MatchView): Placement | undefined {
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
    logger.warn('Yearトーナメントの区画に置けないマッチを除きました', {
      matchId: record.matchId,
    });
    return undefined;
  }
}

// 行ごとに引いても、同じ要求の一括読み込みが全ての行のマッチを1回の照会にまとめ、対戦カードと不戦勝の項目で結果を使い回す
async function placedMatchesOf(
  row: YearTournamentRoundBoardModel,
  context: GraphQLContext,
): Promise<readonly PlacedMatch[]> {
  const views = await Promise.all(
    row.matchIds.map((matchId) => loadMatchView(context, matchId)),
  );
  return views.flatMap((view) => {
    const placement = view === null ? undefined : placementOfView(view);
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

const readerOf = (context: GraphQLContext): YearBoardReader =>
  context.resolve<YearBoardReader>(YEAR_TOURNAMENT_API_TYPES.YearBoardReader);

// ログインを求めず、閲覧者のUpvoteと制限だけをセッションの利用者で変える
export const boardResolvers = {
  Query: {
    yearTournamentBoard: clientOnly(
      withValidatedArgs(
        YEAR_TOURNAMENT_BOARD_ARGS,
        async (_parent: unknown, { date }, context) => {
          const now = clockOf(context).now();
          const rows = await readerOf(context).read(date, now);
          return {
            date,
            serverTime: now,
            rounds: rows.map(toYearTournamentRoundBoard),
          };
        },
      ),
    ),
  },
  YearTournamentRoundBoard: {
    matches: async (row, _args, context) =>
      (await placedMatchesOf(row, context)).flatMap(({ view, placement }) =>
        placement.kind === 'card' ? [view] : [],
      ),
    byes: async (row, _args, context) =>
      (await placedMatchesOf(row, context)).flatMap(toBye),
  },
} satisfies Resolvers;
