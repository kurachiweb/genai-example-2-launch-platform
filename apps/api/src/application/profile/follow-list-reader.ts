import { inject, injectable } from 'inversify';

import type { CurrentUser } from '../../../lib/core/identity/account-guard.ts';
import type {
  FollowDirection,
  FollowEntryView,
  FollowListPosition,
  FollowStore,
} from './ports.ts';
import { PROFILE_TYPES } from './profile-types.ts';

export interface FollowListInput {
  readonly direction: FollowDirection;
  // 1〜20。範囲の検証は呼び出し元の境界で行う
  readonly first: number;
  readonly after: FollowListPosition | undefined;
}

// 対象はセッションの本人だけで、他人の一覧は引数で指定できない
export interface FollowListReader {
  // 最大first+1件。first+1件目は続きの有無の判定だけに使う
  list(
    user: CurrentUser,
    input: FollowListInput,
  ): Promise<readonly FollowEntryView[]>;
}

@injectable()
export class StoreFollowListReader implements FollowListReader {
  constructor(
    @inject(PROFILE_TYPES.FollowStore) private readonly store: FollowStore,
  ) {}

  list(
    user: CurrentUser,
    input: FollowListInput,
  ): Promise<readonly FollowEntryView[]> {
    return this.store.list({
      userId: user.user.id,
      direction: input.direction,
      first: input.first,
      after: input.after,
    });
  }
}
