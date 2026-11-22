import { inject, injectable } from 'inversify';

import type {
  ExportAccount,
  ExportFollow,
  ExportProfile,
} from '../../../../lib/core/data-export/export-snapshot.ts';
import { IDENTITY_PLATFORM_TYPES } from '../../../../lib/core/identity/identifiers.ts';
import type { AccountExport } from '../../../../lib/core/identity/ports.ts';
import { NOTIFICATIONS_PLATFORM_TYPES } from '../../../../lib/core/notifications/identifiers.ts';
import type { NotificationSettingsExport } from '../../../../lib/core/notifications/ports.ts';
import { PROFILE_PLATFORM_TYPES } from '../../../../lib/core/profile/identifiers.ts';
import type {
  FollowExport,
  ProfileExport,
} from '../../../../lib/core/profile/ports.ts';
import { PUBLIC_API_PLATFORM_TYPES } from '../../../../lib/core/public-api/identifiers.ts';
import type { ApiKeyExport } from '../../../../lib/core/public-api/ports.ts';
import { ULTRAS_TYPES } from '../../../../lib/core/ultras/identifiers.ts';
import type { UltrasPlanExport } from '../../../../lib/core/ultras/ports.ts';

export interface AccountSource {
  readonly account: ExportAccount;
  readonly profile: ExportProfile;
  readonly follows: readonly ExportFollow[];
  // ZIPには書かず、決済履歴の照会だけに使う
  readonly pseudonymousId: string;
}

// 他のspecの出力用の部品を呼んで、利用者のアカウント・プロフィール・フォローをスナップショットの形へ写す
@injectable()
export class AccountSourceReader {
  constructor(
    @inject(IDENTITY_PLATFORM_TYPES.AccountExport)
    private readonly accountExport: AccountExport,
    @inject(ULTRAS_TYPES.UltrasPlanExport)
    private readonly ultrasPlanExport: UltrasPlanExport,
    @inject(NOTIFICATIONS_PLATFORM_TYPES.NotificationSettingsExport)
    private readonly notificationSettingsExport: NotificationSettingsExport,
    @inject(PUBLIC_API_PLATFORM_TYPES.ApiKeyExport)
    private readonly apiKeyExport: ApiKeyExport,
    @inject(PROFILE_PLATFORM_TYPES.ProfileExport)
    private readonly profileExport: ProfileExport,
    @inject(PROFILE_PLATFORM_TYPES.FollowExport)
    private readonly followExport: FollowExport,
  ) {}

  async exists(userId: string): Promise<boolean> {
    return (await this.accountExport.find(userId)) !== undefined;
  }

  // アカウントかプロフィールが無い利用者は退会済みとして何も返さない
  async read(userId: string, now: Date): Promise<AccountSource | undefined> {
    const account = await this.accountExport.find(userId);
    if (account === undefined) {
      return undefined;
    }
    const plan = await this.ultrasPlanExport.find(userId, now);
    const notificationSettings =
      await this.notificationSettingsExport.find(userId);
    const apiKeys = await this.apiKeyExport.listByUser(userId);
    const profile = await this.profileExport.find(userId);
    if (profile === undefined) {
      return undefined;
    }
    const follows = await this.followExport.listFollowing(userId);

    return {
      pseudonymousId: account.pseudonymousId,
      account: {
        email: account.email,
        emailVerifiedAt: account.emailVerifiedAt,
        registeredAt: account.registeredAt,
        mfaEnabled: account.mfaEnabled,
        plan:
          plan === null
            ? null
            : {
                status: plan.status,
                startedAt: plan.startedAt,
                currentPeriodEndsAt: plan.currentPeriodEndsAt,
                canceledAt: plan.canceledAt,
              },
        notificationSettings:
          notificationSettings === undefined
            ? null
            : {
                matchPreview: notificationSettings.matchPreview,
                matchResult: notificationSettings.matchResult,
                followedUserMatch: notificationSettings.followedUserMatch,
                followedUserAward: notificationSettings.followedUserAward,
                suppressedReason: notificationSettings.suppressedReason,
              },
        apiKeys: apiKeys.map((key) => ({
          name: key.name,
          scopes: key.scopes,
          createdAt: key.createdAt,
        })),
      },
      profile: {
        handle: profile.handle,
        nickname: profile.nickname,
        headline: profile.headline,
        bioMarkdown: profile.bioMarkdown,
        avatarFileId: profile.avatarFileId,
        websites: profile.websites.map((website) => ({
          name: website.name,
          url: website.url,
        })),
        updatedAt: profile.updatedAt,
      },
      follows: follows.map((follow) => ({
        handle: follow.handle,
        nickname: follow.nickname,
        followedAt: follow.followedAt,
      })),
    };
  }
}
