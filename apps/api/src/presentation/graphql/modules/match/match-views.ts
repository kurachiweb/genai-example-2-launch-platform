import { PLATFORM_TYPES } from '../../../../../lib/core/di/identifiers.ts';
import type { AccountGuard } from '../../../../../lib/core/identity/account-guard.ts';
import { IDENTITY_PLATFORM_TYPES } from '../../../../../lib/core/identity/identifiers.ts';
import type { SessionView } from '../../../../../lib/core/session/session-view.ts';
import type { Clock } from '../../../../../lib/core/time/clock.ts';
import { MATCH_TYPES } from '../../../../application/match/match-types.ts';
import type {
  MatchView,
  MatchViewReader,
} from '../../../../application/match/match-view-reader.ts';
import type { Resolvers } from '../../generated/resolvers-types.ts';
import type { GraphQLContext } from '../../graphql-context.ts';
import { defineLoader } from '../../loaders.ts';
import { productCategoryOf, productImageOf } from '../product/product-views.ts';
import { userSummaryLoader } from '../profile/user-summary.ts';
import {
  MATCH_DECISION_VALUES,
  MATCH_ENTRY_RESULT_VALUES,
  MATCH_KIND_VALUES,
  MATCH_PHASE_VALUES,
  MATCH_STAGE_VALUES,
  UPVOTE_RESTRICTION_VALUES,
} from './mappers.ts';

// 一括読み込みの範囲(LoaderScope)はセッションを持たないため、閲覧者を求めるセッションをキーに添える。同じ要求のキーは同じセッションを持つ
export interface MatchViewKey {
  readonly matchId: string;
  readonly session: SessionView;
}

// 見つからないマッチのキーの位置にnullを置く
export const matchViewLoader = defineLoader<
  MatchViewKey,
  MatchView | null,
  string
>({
  name: 'matchView',
  cacheKey: (key) => key.matchId,
  batch: async (keys, scope) => {
    const [first] = keys;
    if (first === undefined) {
      return [];
    }
    const viewer = await scope
      .resolve<AccountGuard>(IDENTITY_PLATFORM_TYPES.AccountGuard)
      .currentUser(first.session);
    const views = await scope
      .resolve<MatchViewReader>(MATCH_TYPES.MatchViewReader)
      .findViews({
        matchIds: keys.map((key) => key.matchId),
        viewer,
        now: scope.resolve<Clock>(PLATFORM_TYPES.Clock).now(),
      });
    return keys.map((key) => views.get(key.matchId) ?? null);
  },
});

// 後続のモジュールは自分の型の項目でこの値をMatchとして返す
export const loadMatchView = (
  context: GraphQLContext,
  matchId: string,
): Promise<MatchView | null> =>
  context.loaders
    .get(matchViewLoader)
    .load({ matchId, session: context.session });

export const matchViewResolvers = {
  Match: {
    id: (view) => view.record.matchId,
    kind: (view) => MATCH_KIND_VALUES[view.record.kind],
    round: (view) => view.record.round,
    stage: (view) =>
      view.record.stage === null ? null : MATCH_STAGE_VALUES[view.record.stage],
    date: (view) => view.record.matchDate,
    startsAt: (view) => view.record.startsAt,
    endsAt: (view) => view.record.endsAt,
    phase: (view) => MATCH_PHASE_VALUES[view.record.phase],
    decision: (view) =>
      view.record.decision === null
        ? null
        : MATCH_DECISION_VALUES[view.record.decision],
    endedEarly: (view) => view.record.endedEarly,
    entries: (view) => [...view.entries],
    viewerRestriction: (view) =>
      view.viewerRestriction === null
        ? null
        : UPVOTE_RESTRICTION_VALUES[view.viewerRestriction],
  },
  MatchEntry: {
    id: (entry) => entry.entryId,
    result: (entry) =>
      entry.result === null ? null : MATCH_ENTRY_RESULT_VALUES[entry.result],
  },
  MatchProduct: {
    category: (product, _args, context) =>
      productCategoryOf(product.categoryId, context),
    logo: (product, _args, context) =>
      productImageOf(product.logoFileId, context),
  },
  UpvoteHistoryItem: {
    owner: (item, _args, context) =>
      context.loaders.get(userSummaryLoader).load(item.ownerUserId),
  },
} satisfies Resolvers;
