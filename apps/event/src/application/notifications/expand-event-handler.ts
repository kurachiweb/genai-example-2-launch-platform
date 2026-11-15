import { inject, injectable } from 'inversify';

import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import {
  type ExpandNotificationEventBody,
  NOTIFICATION_CONTINUE_DELAY_SECONDS,
} from '../../../lib/core/messaging/contracts/notifications.ts';
import type {
  MessageHandler,
  MessageHandlingResult,
} from '../../../lib/core/messaging/message-contract.ts';
import { NOTIFICATIONS_PLATFORM_TYPES } from '../../../lib/core/notifications/identifiers.ts';
import type {
  NotificationEventExpander,
  NotificationWorkRequester,
} from '../../../lib/core/notifications/ports.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';

// 受賞のフォロワーは数万件になり得るため、1回の処理で記録する通知の数を区切り、続きは遅延再送で受け取る
export const EXPAND_EVENT_BUDGET = 2000;

const DONE: MessageHandlingResult = Object.freeze({ kind: 'done' });

const CONTINUE: MessageHandlingResult = Object.freeze({
  kind: 'defer',
  delaySeconds: NOTIFICATION_CONTINUE_DELAY_SECONDS,
});

// 例外は捕まえずに投げる。展開済みの通知イベントの再試行でも展開の部品が受賞の枠を返すため、送り出しの依頼が失敗しても再試行で依頼し直せる
@injectable()
export class ExpandEventHandler implements MessageHandler<ExpandNotificationEventBody> {
  constructor(
    @inject(NOTIFICATIONS_PLATFORM_TYPES.NotificationEventExpander)
    private readonly expander: NotificationEventExpander,
    @inject(NOTIFICATIONS_PLATFORM_TYPES.NotificationWorkRequester)
    private readonly requester: NotificationWorkRequester,
    @inject(PLATFORM_TYPES.Clock)
    private readonly clock: Clock,
  ) {}

  async handle(
    body: ExpandNotificationEventBody,
  ): Promise<MessageHandlingResult> {
    const expansion = await this.expander.expand(
      body.eventId,
      this.clock.now(),
      EXPAND_EVENT_BUDGET,
    );
    if (expansion.kind === 'continue') {
      return CONTINUE;
    }
    const slotKeys = new Set(expansion.lateSlotKeys);
    if (expansion.flushSlotKey !== null) {
      slotKeys.add(expansion.flushSlotKey);
    }
    for (const slotKey of slotKeys) {
      await this.requester.flushSlot(slotKey, 0);
    }
    return DONE;
  }
}
