import { inject, injectable } from 'inversify';

import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type { CurrentUser } from '../../../lib/core/identity/account-guard.ts';
import type { IdGenerator } from '../../../lib/core/ids/id-generator.ts';
import {
  decideUpvote,
  type UpvoteRestriction,
  viewerRestriction,
} from '../../domain/match/upvote-plan.ts';
import {
  type MatchErrorCode,
  matchError,
  upvoteEntryRejectedError,
} from './match-errors.ts';
import { MATCH_TYPES } from './match-types.ts';
import type { UpvoteState, UpvoteStore } from './ports.ts';
import { upvoteViewerOf } from './upvote-viewer.ts';

export interface UpvoteRequest {
  readonly user: CurrentUser;
  readonly matchId: string;
  readonly entryId: string;
  readonly now: Date;
}

export interface UpvoteCancelRequest {
  readonly user: CurrentUser;
  readonly matchId: string;
  readonly now: Date;
}

// 未ログイン・停止中・未確認の拒否とbot判定は呼び出し元のリゾルバが先に行い、更新後のマッチは呼び出し元がマッチの表示の組み立てで返す
export interface UpvoteService {
  upvote(input: UpvoteRequest): Promise<void>;
  cancel(input: UpvoteCancelRequest): Promise<void>;
}

const ERROR_OF_RESTRICTION: Readonly<
  Record<UpvoteRestriction, MatchErrorCode>
> = Object.freeze({
  not_accepting: 'upvote_not_accepting',
  guest: 'unauthenticated',
  account_unavailable: 'account_unavailable',
  email_not_verified: 'email_not_verified',
  own_match: 'upvote_own_match',
});

@injectable()
export class StoreUpvoteService implements UpvoteService {
  constructor(
    @inject(MATCH_TYPES.UpvoteStore) private readonly store: UpvoteStore,
    @inject(PLATFORM_TYPES.IdGenerator) private readonly ids: IdGenerator,
  ) {}

  async upvote(input: UpvoteRequest): Promise<void> {
    const { user, matchId, entryId, now } = input;
    const userId = user.user.id;
    const state = await this.stateOf(matchId, userId, now);
    if (!state.entryIds.includes(entryId)) {
      throw upvoteEntryRejectedError();
    }
    assertUpvotable(state, user);
    const action = decideUpvote({
      currentEntryId: state.currentEntryId,
      targetEntryId: entryId,
    });
    if (action.kind === 'none') {
      return;
    }
    const result = await this.store.apply({
      action,
      matchId,
      userId,
      upvoteId: this.ids.generate(),
      now,
    });
    // duplicateは同時の別の要求が既に有効なUpvoteを残したことで、有効なUpvoteが1つの状態は保たれている
    if (result !== 'rejected') {
      return;
    }
    // 記録の時点の条件の不成立の理由を、読み直した状態で分類する。マッチの条件に当たらなければ、残る条件は利用者の状態の変化である
    assertUpvotable(await this.stateOf(matchId, userId, now), user);
    throw matchError('account_unavailable');
  }

  async cancel(input: UpvoteCancelRequest): Promise<void> {
    const { matchId, now } = input;
    const userId = input.user.user.id;
    const result = await this.store.cancel({ matchId, userId, now });
    if (result === 'cancelled') {
      return;
    }
    const state = await this.stateOf(matchId, userId, now);
    if (state.phase !== 'live') {
      throw matchError('upvote_not_accepting');
    }
  }

  private async stateOf(
    matchId: string,
    userId: string,
    now: Date,
  ): Promise<UpvoteState> {
    const state = await this.store.findState(matchId, userId, now);
    if (state === undefined) {
      throw matchError('match_not_found');
    }
    return state;
  }
}

function assertUpvotable(state: UpvoteState, user: CurrentUser): void {
  const restriction = viewerRestriction({
    viewer: upvoteViewerOf(user),
    phase: state.phase,
    ownerUserIds: state.ownerUserIds,
  });
  if (restriction !== null) {
    throw matchError(ERROR_OF_RESTRICTION[restriction]);
  }
}
