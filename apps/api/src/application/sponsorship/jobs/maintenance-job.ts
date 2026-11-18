import { inject, injectable } from 'inversify';

import { getAppLogger } from '../../../../lib/core/logging/app-logger.ts';
import type {
  ScheduledJobContext,
  ScheduledJobDefinition,
  ScheduledJobHandler,
} from '../../../../lib/core/scheduling/cron-registry.ts';
import { SPONSORSHIP_PLATFORM_TYPES } from '../../../../lib/core/sponsorship/identifiers.ts';
import type {
  DisplayStopStore,
  NoticeRequester,
  NoticeScheduler,
  SponsorshipStore,
} from '../../../../lib/core/sponsorship/ports.ts';
import {
  addBusinessDays,
  type BusinessDate,
  fromBusinessDateTime,
} from '../../../../lib/core/time/business-time.ts';
import { SPONSORSHIP_TYPES } from '../sponsorship-types.ts';

// 同じ4:21の起動で、Weekトーナメントの再処理(order 1500)の後・Yearトーナメントの再処理(order 1700)の前に動く
export const SPONSORSHIP_MAINTENANCE_JOB_DEFINITION: ScheduledJobDefinition =
  Object.freeze({
    name: 'sponsorship.maintenance',
    at: Object.freeze({ hour: 4, minute: 21 }),
    order: 1600,
    handler: SPONSORSHIP_TYPES.MaintenanceJob,
  });

// 4:21の起動の時間の予算とD1の負荷に収めるため1回の起動で消す件数を区切り、残りは翌日の起動に任せる
export const SPONSORSHIP_UNPAID_DELETE_BATCH_SIZE = 500;

export const SPONSORSHIP_UNPAID_DELETE_MAX_BATCHES = 20;

export const SPONSORSHIP_DISPLAY_STOP_DELETE_LIMIT = 500;

// 最長366日の掲載期間と重なり得なくなった区間だけを消す
const DISPLAY_STOP_RETENTION_DAYS = 400;

const START_OF_DAY = Object.freeze({ hour: 0, minute: 0 });

const logger = getAppLogger(['api', 'application', 'sponsorship']);

export function displayStopRetentionCutoff(today: BusinessDate): Date {
  return fromBusinessDateTime(
    addBusinessDays(today, -DISPLAY_STOP_RETENTION_DAYS),
    START_OF_DAY,
  );
}

interface UnpaidDeletion {
  readonly deleted: number;
  readonly limitReached: boolean;
}

@injectable()
export class MaintenanceJob implements ScheduledJobHandler {
  constructor(
    @inject(SPONSORSHIP_PLATFORM_TYPES.SponsorshipStore)
    private readonly store: SponsorshipStore,
    @inject(SPONSORSHIP_PLATFORM_TYPES.NoticeScheduler)
    private readonly scheduler: NoticeScheduler,
    @inject(SPONSORSHIP_PLATFORM_TYPES.NoticeRequester)
    private readonly requester: NoticeRequester,
    @inject(SPONSORSHIP_PLATFORM_TYPES.DisplayStopStore)
    private readonly displayStops: DisplayStopStore,
  ) {}

  // 0:07の依頼の失敗・精算の漏れ・0:07の直前の決済の確定との競合を補う。各手順は状態を条件に進めるため、2回実行しても結果は変わらない
  async run({ business }: ScheduledJobContext): Promise<void> {
    const today = business.date;
    const unpaid = await this.#deleteExpiredUnpaid(today);
    const unsettled = await this.store.listUnsettledEnded(today, 1);
    const settlementRequested = unsettled.length > 0;
    if (settlementRequested) {
      await this.requester.requestSettlement();
    }
    await this.scheduler.markDue(today);
    const deletedDisplayStops = await this.displayStops.deleteEndedBefore(
      displayStopRetentionCutoff(today),
      SPONSORSHIP_DISPLAY_STOP_DELETE_LIMIT,
    );
    const noticesRequested = await this.scheduler.hasPending();
    if (noticesRequested) {
      await this.requester.request();
    }
    logger.info('スポンサー広告の日次の処理を行いました', {
      deletedUnpaid: unpaid.deleted,
      unpaidLimitReached: unpaid.limitReached,
      settlementRequested,
      deletedDisplayStops,
      noticesRequested,
    });
  }

  async #deleteExpiredUnpaid(today: BusinessDate): Promise<UnpaidDeletion> {
    let deleted = 0;
    let batches = 0;
    let lastCount: number;
    do {
      lastCount = await this.store.deleteExpiredUnpaid(
        today,
        SPONSORSHIP_UNPAID_DELETE_BATCH_SIZE,
      );
      deleted += lastCount;
      batches += 1;
    } while (
      lastCount === SPONSORSHIP_UNPAID_DELETE_BATCH_SIZE &&
      batches < SPONSORSHIP_UNPAID_DELETE_MAX_BATCHES
    );
    return {
      deleted,
      limitReached: lastCount === SPONSORSHIP_UNPAID_DELETE_BATCH_SIZE,
    };
  }
}
