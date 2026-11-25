import { inject, injectable } from 'inversify';

import type {
  ScheduledJobContext,
  ScheduledJobDefinition,
  ScheduledJobHandler,
} from '../../../../lib/core/scheduling/cron-registry.ts';
import { SPONSORSHIP_PLATFORM_TYPES } from '../../../../lib/core/sponsorship/identifiers.ts';
import { SPONSORSHIP_DAILY_NOTICES_TIME } from '../../../../lib/core/sponsorship/notice-schedule.ts';
import type {
  NoticeRequester,
  NoticeScheduler,
} from '../../../../lib/core/sponsorship/ports.ts';
import { SPONSORSHIP_TYPES } from '../sponsorship-types.ts';

// 0:07は他の機能のジョブが無い時刻で、本機能に割り当てられた帯の1600を使う
export const SPONSORSHIP_DAILY_NOTICES_JOB_DEFINITION: ScheduledJobDefinition =
  Object.freeze({
    name: 'sponsorship.daily-notices',
    at: SPONSORSHIP_DAILY_NOTICES_TIME,
    order: 1600,
    handler: SPONSORSHIP_TYPES.DailyNoticesJob,
  });

// 精算は区間の照会と返金の依頼で広告ごとに数回の往復を要するため、ここでは行わずイベントサーバーのメッセージの処理へ委ねる。
// 失敗しても依頼待ちの行と未精算の行が残り、4:21の日次の処理が依頼し直す
@injectable()
export class DailyNoticesJob implements ScheduledJobHandler {
  constructor(
    @inject(SPONSORSHIP_PLATFORM_TYPES.NoticeScheduler)
    private readonly scheduler: NoticeScheduler,
    @inject(SPONSORSHIP_PLATFORM_TYPES.NoticeRequester)
    private readonly requester: NoticeRequester,
  ) {}

  async run({ business }: ScheduledJobContext): Promise<void> {
    await this.scheduler.markDue(business.date);
    await this.requester.request();
    await this.requester.requestSettlement();
  }
}
