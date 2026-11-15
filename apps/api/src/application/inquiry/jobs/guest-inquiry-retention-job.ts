import { inject, injectable } from 'inversify';

import { getAppLogger } from '../../../../lib/core/logging/app-logger.ts';
import type {
  ScheduledJobContext,
  ScheduledJobDefinition,
  ScheduledJobHandler,
} from '../../../../lib/core/scheduling/cron-registry.ts';
import { INQUIRY_TYPES } from '../inquiry-types.ts';
import type { GuestInquiryStore } from '../ports.ts';

const GUEST_INQUIRY_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;

// Workersのcpu時間に収めるため1回の起動で消す件数を区切り、残りは翌日の起動に任せる
export const GUEST_INQUIRY_DELETE_BATCH_SIZE = 500;

export const GUEST_INQUIRY_DELETE_MAX_BATCHES = 20;

export const GUEST_INQUIRY_RETENTION_JOB_DEFINITION: ScheduledJobDefinition =
  Object.freeze({
    name: 'inquiry-chat.guest-inquiry-retention',
    at: Object.freeze({ hour: 4, minute: 21 }),
    order: 300,
    handler: INQUIRY_TYPES.GuestInquiryRetentionJob,
  });

const logger = getAppLogger(['api', 'inquiry', 'guest-inquiry-retention']);

export function guestInquiryRetentionThreshold(scheduledTime: Date): Date {
  return new Date(scheduledTime.getTime() - GUEST_INQUIRY_RETENTION_MS);
}

@injectable()
export class GuestInquiryRetentionJob implements ScheduledJobHandler {
  constructor(
    @inject(INQUIRY_TYPES.GuestInquiryStore)
    private readonly store: GuestInquiryStore,
  ) {}

  async run({ scheduledTime }: ScheduledJobContext): Promise<void> {
    const threshold = guestInquiryRetentionThreshold(scheduledTime);
    let deleted = 0;
    let batches = 0;
    let lastCount: number;
    do {
      lastCount = await this.store.deleteClosedBefore(
        threshold,
        GUEST_INQUIRY_DELETE_BATCH_SIZE,
      );
      deleted += lastCount;
      batches += 1;
    } while (
      lastCount === GUEST_INQUIRY_DELETE_BATCH_SIZE &&
      batches < GUEST_INQUIRY_DELETE_MAX_BATCHES
    );
    logger.info('保持期間を過ぎた未ログインの問い合わせを削除しました', {
      deleted,
      batches,
      limitReached: lastCount === GUEST_INQUIRY_DELETE_BATCH_SIZE,
    });
  }
}
