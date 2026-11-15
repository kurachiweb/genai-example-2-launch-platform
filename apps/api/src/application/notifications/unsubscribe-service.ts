import { inject, injectable } from 'inversify';

import type { NotificationTopic } from '../../../common-lib/notifications/notification-topics.ts';
import { NOTIFICATIONS_PLATFORM_TYPES } from '../../../lib/core/notifications/identifiers.ts';
import type {
  NotificationPreferenceStore,
  UnsubscribeTokenService,
} from '../../../lib/core/notifications/ports.ts';
import { notificationsError } from './notifications-errors.ts';

export interface UnsubscribeLinkView {
  readonly topic: NotificationTopic;
  readonly enabled: boolean;
}

export interface UnsubscribeConfirmation {
  readonly topic: NotificationTopic;
  readonly alreadyDisabled: boolean;
}

// ログインを求めず、トークンの組の種別の照会と停止だけを行わせる
export interface UnsubscribeService {
  // 無効なトークンはnull
  inspect(token: string): Promise<UnsubscribeLinkView | null>;
  // 無効なトークンはAppError(invalid_link)
  confirm(token: string, now: Date): Promise<UnsubscribeConfirmation>;
}

@injectable()
export class TokenUnsubscribeService implements UnsubscribeService {
  constructor(
    @inject(NOTIFICATIONS_PLATFORM_TYPES.UnsubscribeTokenService)
    private readonly tokens: UnsubscribeTokenService,
    @inject(NOTIFICATIONS_PLATFORM_TYPES.NotificationPreferenceStore)
    private readonly preferences: NotificationPreferenceStore,
  ) {}

  async inspect(token: string): Promise<UnsubscribeLinkView | null> {
    const target = await this.tokens.resolve(token);
    if (target === undefined) {
      return null;
    }
    const preferences = await this.preferences.preferencesOf(target.userId);
    return {
      topic: target.topic,
      enabled: preferences.get(target.topic) === true,
    };
  }

  async confirm(token: string, now: Date): Promise<UnsubscribeConfirmation> {
    const target = await this.tokens.resolve(token);
    if (target === undefined) {
      throw notificationsError('invalid_link');
    }
    const preferences = await this.preferences.preferencesOf(target.userId);
    if (preferences.get(target.topic) !== true) {
      return { topic: target.topic, alreadyDisabled: true };
    }
    await this.preferences.setPreference({
      userId: target.userId,
      topic: target.topic,
      enabled: false,
      at: now,
    });
    return { topic: target.topic, alreadyDisabled: false };
  }
}
