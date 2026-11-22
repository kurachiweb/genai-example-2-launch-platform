import { captureEvent } from '@sentry/cloudflare';
import { injectable } from 'inversify';

import { getAppLogger } from '../../../lib/core/logging/app-logger.ts';
import type {
  ReportIncident,
  ReportIncidentContext,
  ReportIncidentReporter,
} from '../../application/reporting/ports.ts';

const MESSAGES: Readonly<Record<ReportIncident, string>> = {
  'notice-redispatch-failed':
    '通報の当事者への通知の送り直しに失敗したものがあります',
  'inquiry-record-failed':
    '権利侵害の照会のメールを依頼した後に、照会を記録できませんでした',
};

const CONTEXT_NAME = 'report_incident';

const logger = getAppLogger(['api', 'infrastructure', 'reporting']);

@injectable()
export class SentryReportIncidentReporter implements ReportIncidentReporter {
  report(
    incident: ReportIncident,
    { job, caseId, count }: ReportIncidentContext,
  ): void {
    const message = MESSAGES[incident];
    logger.error(message, { incident, job, caseId, count });
    const details = {
      ...(caseId === undefined ? {} : { caseId }),
      ...(count === undefined ? {} : { count }),
    };
    // captureMessageの文言だけのイベントは、直前と同じ文言と指紋なら重複として捨てられ、翌日も続く同じ出来事を通知できない。文言をlogentryに置くと重複の判定から外れる。案件のIDは値の種類が多く絞り込みに使わないため、タグでなく文脈に置く
    captureEvent({
      level: 'error',
      logentry: { message },
      fingerprint: ['reporting', incident],
      tags: {
        report_incident: incident,
        ...(job === undefined ? {} : { job }),
      },
      ...(Object.keys(details).length === 0
        ? {}
        : { contexts: { [CONTEXT_NAME]: details } }),
    });
  }
}
