import { inject, injectable } from 'inversify';

import { getAppLogger } from '../../../../lib/core/logging/app-logger.ts';
import type {
  ScheduledJobContext,
  ScheduledJobDefinition,
  ScheduledJobHandler,
} from '../../../../lib/core/scheduling/cron-registry.ts';
import type {
  ReportIncidentReporter,
  ReportNoticeStore,
  ReportNotifier,
} from '../ports.ts';
import { REPORTING_TYPES } from '../reporting-types.ts';

export const REPORT_NOTICE_REDISPATCH_JOB_DEFINITION: ScheduledJobDefinition =
  Object.freeze({
    name: 'content-reporting.notice-redispatch',
    at: Object.freeze({ hour: 4, minute: 21 }),
    order: 2000,
    handler: REPORTING_TYPES.ReportNoticeRedispatchJob,
  });

// 4:21の起動の時間の予算を他の機能のジョブと共有するため、1回の起動で送り直す案件を区切り、残りは翌日の起動に任せる
export const REPORT_NOTICE_REDISPATCH_LIMIT = 100;

// 完了の直後の通知の依頼と重ならないよう、完了から1時間以上経った依頼待ちだけを送り直す
const REDISPATCH_AFTER_MS = 60 * 60 * 1000;

const logger = getAppLogger(['api', 'reporting', 'notice-redispatch']);

interface RedispatchSummary {
  readonly found: number;
  readonly requested: number;
  readonly skipped: number;
  // 読んだ後に再開や別の送信で依頼待ちが無くなり、何も進めなかった案件
  readonly idle: number;
  readonly failed: number;
}

@injectable()
export class ReportNoticeRedispatchJob implements ScheduledJobHandler {
  constructor(
    @inject(REPORTING_TYPES.ReportNoticeStore)
    private readonly notices: ReportNoticeStore,
    @inject(REPORTING_TYPES.ReportNotifier)
    private readonly notifier: ReportNotifier,
    @inject(REPORTING_TYPES.ReportIncidentReporter)
    private readonly reporter: ReportIncidentReporter,
  ) {}

  // 依頼待ちの通知だけを進め、同じ完了の通知は同じ冪等のキーで依頼するため、2回実行しても宛先ごとの通知は重ならない
  async run({ scheduledTime }: ScheduledJobContext): Promise<void> {
    const caseIds = await this.notices.listCasesWithPendingNotices({
      closedBefore: new Date(scheduledTime.getTime() - REDISPATCH_AFTER_MS),
      limit: REPORT_NOTICE_REDISPATCH_LIMIT,
    });
    let requested = 0;
    let skipped = 0;
    let idle = 0;
    let failed = 0;
    for (const caseId of caseIds) {
      try {
        const count = await this.notifier.dispatch(caseId);
        requested += count.requested;
        skipped += count.skipped;
        if (count.requested + count.skipped === 0) {
          idle += 1;
        }
      } catch (error: unknown) {
        failed += 1;
        logger.warning('通報の当事者への通知を送り直せませんでした', {
          caseId,
          error,
        });
      }
    }
    // 失敗した通知は依頼待ちのまま残り翌日の起動が再び拾うため、ジョブは失敗にせず件数だけを運用者へ知らせる
    if (failed > 0) {
      this.reporter.report('notice-redispatch-failed', {
        job: REPORT_NOTICE_REDISPATCH_JOB_DEFINITION.name,
        count: failed,
      });
    }
    const summary: RedispatchSummary = {
      found: caseIds.length,
      requested,
      skipped,
      idle,
      failed,
    };
    logger.info('通報の当事者への通知を送り直しました', { ...summary });
  }
}
