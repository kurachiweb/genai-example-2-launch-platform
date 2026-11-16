import { captureEvent } from '@sentry/cloudflare';
import { injectable } from 'inversify';

import { getAppLogger } from '../../../lib/core/logging/app-logger.ts';
import type {
  EngagementIncident,
  EngagementIncidentReporter,
} from '../../application/engagement/ports.ts';

const MESSAGES: Readonly<Record<EngagementIncident['kind'], string>> = {
  'comment-anonymization-overdue':
    '削除から14日の匿名化の期限までに匿名化できないおそれのあるコメントが残っています',
};

const CONTEXT_NAME = 'engagement_incident';

const logger = getAppLogger(['api', 'infrastructure', 'engagement']);

@injectable()
export class SentryEngagementIncidentReporter implements EngagementIncidentReporter {
  report(incident: EngagementIncident): void {
    const message = MESSAGES[incident.kind];
    logger.error(message, { incident: incident.kind, count: incident.count });
    // captureMessageの文言だけのイベントは、直前と同じ文言と指紋なら重複として捨てられ、翌日も続く同じ出来事を通知できない。文言をlogentryに置くと重複の判定から外れる
    captureEvent({
      level: 'error',
      logentry: { message },
      fingerprint: ['engagement', incident.kind],
      tags: { engagement_incident: incident.kind },
      contexts: { [CONTEXT_NAME]: { count: incident.count } },
    });
  }
}
