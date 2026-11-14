import { inject, injectable } from 'inversify';

import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type { CurrentUser } from '../../../lib/core/identity/account-guard.ts';
import type { IdGenerator } from '../../../lib/core/ids/id-generator.ts';
import { PROFILE_PLATFORM_TYPES } from '../../../lib/core/profile/identifiers.ts';
import type {
  UserProfileDirectory,
  UserSummaryRecord,
} from '../../../lib/core/profile/ports.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import type { FollowStore } from './ports.ts';
import { profileError } from './profile-errors.ts';
import { PROFILE_TYPES } from './profile-types.ts';

export interface FollowState {
  // 相手の現在のハンドル
  readonly handle: string;
  readonly following: boolean;
  // 相手の可視のフォロワー数
  readonly followerCount: number;
}

// 利用者が確認済み(フォロー)・書き込み可能(解除)であることは呼び出し元のリゾルバが確かめる
export interface FollowService {
  follow(user: CurrentUser, handle: string): Promise<FollowState>;
  unfollow(user: CurrentUser, handle: string): Promise<FollowState>;
}

@injectable()
export class StoreFollowService implements FollowService {
  constructor(
    @inject(PROFILE_PLATFORM_TYPES.UserProfileDirectory)
    private readonly directory: UserProfileDirectory,
    @inject(PROFILE_TYPES.FollowStore) private readonly store: FollowStore,
    @inject(PLATFORM_TYPES.IdGenerator) private readonly ids: IdGenerator,
    @inject(PLATFORM_TYPES.Clock) private readonly clock: Clock,
  ) {}

  async follow(user: CurrentUser, handle: string): Promise<FollowState> {
    const target = await this.resolveTarget(handle);
    if (target.userId === user.user.id) {
      throw profileError('cannot_follow_self');
    }
    if (target.suspended) {
      throw profileError('follow_target_unavailable');
    }
    const result = await this.store.insertIfAbsent({
      id: this.ids.generate(),
      followerId: user.user.id,
      followeeId: target.userId,
      now: this.clock.now(),
    });
    if (result === 'target-unavailable') {
      throw profileError('follow_target_unavailable');
    }
    return this.stateOf(target, true);
  }

  async unfollow(user: CurrentUser, handle: string): Promise<FollowState> {
    const target = await this.resolveTarget(handle);
    await this.store.delete(user.user.id, target.userId);
    return this.stateOf(target, false);
  }

  // 解決は停止中の利用者も返すため、フォローでは呼び出し側で停止中を拒否し、解除ではそのまま使う
  private async resolveTarget(handle: string): Promise<UserSummaryRecord> {
    const resolution = await this.directory.resolveHandle(handle);
    if (resolution.kind === 'none') {
      throw profileError('follow_target_unavailable');
    }
    return resolution.user;
  }

  private async stateOf(
    target: UserSummaryRecord,
    following: boolean,
  ): Promise<FollowState> {
    return {
      handle: target.handle,
      following,
      followerCount: await this.store.countVisibleFollowers(target.userId),
    };
  }
}
