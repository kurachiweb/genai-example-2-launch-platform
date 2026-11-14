import { inject, injectable } from 'inversify';

import { toMatchingKey } from '../../core/email/email-address.ts';
import { EMAIL_TYPES } from '../../core/email/identifiers.ts';
import type { SuppressionList } from '../../core/email/ports.ts';
import { IDENTITY_PLATFORM_TYPES } from '../../core/identity/identifiers.ts';
import type { UserContactDirectory } from '../../core/identity/ports.ts';
import { suppressionReasonOf } from '../../core/notifications/notice-copy.ts';
import { NOTIFICATIONS_PLATFORM_TYPES } from '../../core/notifications/identifiers.ts';
import type {
  NotificationPreferenceStore,
  NotificationSettingsExport,
  NotificationSettingsExportRecord,
} from '../../core/notifications/ports.ts';

@injectable()
export class D1NotificationSettingsExport implements NotificationSettingsExport {
  constructor(
    @inject(NOTIFICATIONS_PLATFORM_TYPES.NotificationPreferenceStore)
    private readonly preferences: NotificationPreferenceStore,
    @inject(IDENTITY_PLATFORM_TYPES.UserContactDirectory)
    private readonly contacts: UserContactDirectory,
    @inject(EMAIL_TYPES.SuppressionList)
    private readonly suppressions: SuppressionList,
  ) {}

  // 停止中の利用者も出力の対象のため状態は見ない。D1の失敗は呼び出し元の再試行に任せるため例外のまま投げる
  async find(
    userId: string,
  ): Promise<NotificationSettingsExportRecord | undefined> {
    const contact = await this.contacts.findContact(userId);
    if (contact === undefined) {
      return undefined;
    }
    const [enabled, suppression] = await Promise.all([
      this.preferences.preferencesOf(userId),
      this.suppressions.getStatus(toMatchingKey(contact.email)),
    ]);
    return {
      matchPreview: enabled.get('match_preview') ?? false,
      matchResult: enabled.get('match_result') ?? false,
      followedUserMatch: enabled.get('followed_user_match') ?? false,
      followedUserAward: enabled.get('followed_user_award') ?? false,
      suppressedReason: suppression.suppressed
        ? suppressionReasonOf(suppression.lastReason)
        : null,
    };
  }
}
