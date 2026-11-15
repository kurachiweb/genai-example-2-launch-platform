import { inject, injectable } from 'inversify';

import type { NotificationTopic } from '../../../common-lib/notifications/notification-topics.ts';
import { NOTIFICATIONS_PLATFORM_TYPES } from '../../../lib/core/notifications/identifiers.ts';
import type {
  NotificationPreferenceStore,
  UnsubscribeTokenService,
} from '../../../lib/core/notifications/ports.ts';

export type OneClickUnsubscribeResult =
  | { readonly kind: 'invalid' }
  | {
      readonly kind: 'unsubscribed';
      readonly topic: NotificationTopic;
      readonly alreadyDisabled: boolean;
    };

// ログインを求めない経路から呼ばれるため、トークンではその組の種別の受信の停止だけを行う。利用者の状態は見ず、退会で種が消えたトークンは照合できない
@injectable()
export class OneClickUnsubscribe {
  constructor(
    @inject(NOTIFICATIONS_PLATFORM_TYPES.UnsubscribeTokenService)
    private readonly tokens: UnsubscribeTokenService,
    @inject(NOTIFICATIONS_PLATFORM_TYPES.NotificationPreferenceStore)
    private readonly preferences: NotificationPreferenceStore,
  ) {}

  async execute(token: string, now: Date): Promise<OneClickUnsubscribeResult> {
    const target = await this.tokens.resolve(token);
    if (target === undefined) {
      return { kind: 'invalid' };
    }
    const preferences = await this.preferences.preferencesOf(target.userId);
    if (preferences.get(target.topic) !== true) {
      return {
        kind: 'unsubscribed',
        topic: target.topic,
        alreadyDisabled: true,
      };
    }
    await this.preferences.setPreference({
      userId: target.userId,
      topic: target.topic,
      enabled: false,
      at: now,
    });
    return {
      kind: 'unsubscribed',
      topic: target.topic,
      alreadyDisabled: false,
    };
  }
}
