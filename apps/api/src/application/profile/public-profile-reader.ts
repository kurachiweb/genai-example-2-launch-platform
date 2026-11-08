import { inject, injectable } from 'inversify';

import { checkHandleFormat } from '../../../common-lib/handles/handle-rules.ts';
import { USER_HANDLE_RULE } from '../../../common-lib/profile/profile-input-rules.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type { AccountGuard } from '../../../lib/core/identity/account-guard.ts';
import { IDENTITY_PLATFORM_TYPES } from '../../../lib/core/identity/identifiers.ts';
import { getAppLogger } from '../../../lib/core/logging/app-logger.ts';
import { PROFILE_PLATFORM_TYPES } from '../../../lib/core/profile/identifiers.ts';
import type {
  UserProfileDirectory,
  UserSummaryRecord,
} from '../../../lib/core/profile/ports.ts';
import type { SessionView } from '../../../lib/core/session/session-view.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import { ULTRAS_TYPES } from '../../../lib/core/ultras/identifiers.ts';
import type { UltrasEntitlements } from '../../../lib/core/ultras/ports.ts';
import { canViewOwnProfile } from '../../domain/identity/user-account.ts';
import type { PublicProfileRecord, PublicProfileStore } from './ports.ts';
import { PROFILE_TYPES } from './profile-types.ts';

export type ProfileViewerRelation =
  'owner' | 'following' | 'not-following' | 'guest';

export interface PublicProfileView {
  readonly handle: string;
  readonly nickname: string;
  readonly headline: string | null;
  readonly bioMarkdown: string | null;
  readonly avatarFileId: string | null;
  readonly websites: readonly {
    readonly name: string | null;
    readonly url: string;
  }[];
  readonly followerCount: number;
  readonly ultras: boolean;
  // 本人にだけ真になり得る
  readonly suspended: boolean;
  readonly viewerRelation: ProfileViewerRelation;
}

export type PublicProfileResult =
  | { readonly kind: 'profile'; readonly profile: PublicProfileView }
  | { readonly kind: 'redirect'; readonly handle: string }
  | { readonly kind: 'not-found' };

export interface PublicProfileReader {
  find(session: SessionView, handle: string): Promise<PublicProfileResult>;
}

const logger = getAppLogger(['api', 'application', 'profile']);

const NOT_FOUND: PublicProfileResult = Object.freeze({ kind: 'not-found' });

// 保有者が可視か、停止中で閲覧者が本人のときだけ表示できる
const isViewable = (
  target: UserSummaryRecord,
  viewerUserId: string | undefined,
): boolean =>
  canViewOwnProfile(
    {
      id: target.userId,
      status: target.suspended ? 'suspended' : 'active',
      emailVerifiedAt: null,
      deletedAt: null,
    },
    viewerUserId,
  );

const relationOf = (
  userId: string,
  viewerUserId: string | undefined,
  record: PublicProfileRecord,
): ProfileViewerRelation => {
  if (viewerUserId === undefined) {
    return 'guest';
  }
  if (viewerUserId === userId) {
    return 'owner';
  }
  return record.viewerFollows ? 'following' : 'not-following';
};

@injectable()
export class DefaultPublicProfileReader implements PublicProfileReader {
  constructor(
    @inject(IDENTITY_PLATFORM_TYPES.AccountGuard)
    private readonly guard: AccountGuard,
    @inject(PROFILE_PLATFORM_TYPES.UserProfileDirectory)
    private readonly directory: UserProfileDirectory,
    @inject(PROFILE_TYPES.PublicProfileStore)
    private readonly store: PublicProfileStore,
    @inject(ULTRAS_TYPES.UltrasEntitlements)
    private readonly entitlements: UltrasEntitlements,
    @inject(PLATFORM_TYPES.Clock) private readonly clock: Clock,
  ) {}

  async find(
    session: SessionView,
    handle: string,
  ): Promise<PublicProfileResult> {
    if (checkHandleFormat(handle, USER_HANDLE_RULE) !== 'ok') {
      return NOT_FOUND;
    }
    const viewerUserId = (await this.guard.currentUser(session))?.user.id;
    const resolution = await this.directory.resolveHandle(handle);
    if (
      resolution.kind === 'none' ||
      !isViewable(resolution.user, viewerUserId)
    ) {
      return NOT_FOUND;
    }
    if (resolution.kind === 'previous') {
      return { kind: 'redirect', handle: resolution.user.handle };
    }
    const { userId } = resolution.user;
    const [record, ultras] = await Promise.all([
      this.store.load(userId, viewerUserId),
      this.isUltras(userId),
    ]);
    if (record === undefined) {
      return NOT_FOUND;
    }
    return {
      kind: 'profile',
      profile: {
        handle: record.handle,
        nickname: record.nickname,
        headline: record.headline,
        bioMarkdown: record.bioMarkdown,
        avatarFileId: record.avatarFileId,
        websites: record.websites,
        followerCount: record.followerCount,
        suspended: record.suspended,
        ultras,
        viewerRelation: relationOf(userId, viewerUserId, record),
      },
    };
  }

  // Ultrasの表示は付加的なため、判定に失敗してもプロフィール全体を失敗させない
  private async isUltras(userId: string): Promise<boolean> {
    try {
      return await this.entitlements.isEntitledAt(userId, this.clock.now());
    } catch (error: unknown) {
      logger.warning(
        'Ultrasの加入状態を判定できないため、表示しないものとして扱いました',
        {
          userId,
          error,
        },
      );
      return false;
    }
  }
}
