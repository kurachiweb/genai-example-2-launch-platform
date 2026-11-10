import { captureEvent } from '@sentry/cloudflare';
import { injectable } from 'inversify';

import { getAppLogger } from '../../../lib/core/logging/app-logger.ts';
import type {
  MatchIncident,
  MatchIncidentReporter,
} from '../../application/match/ports.ts';

const MESSAGES: Readonly<Record<MatchIncident['kind'], string>> = {
  'match-kickoff-late': '開始の日時から10分を過ぎて開始したマッチがあります',
};

const CONTEXT_NAME = 'match_incident';

const logger = getAppLogger(['api', 'infrastructure', 'match']);

@injectable()
export class SentryMatchIncidentReporter implements MatchIncidentReporter {
  report(incident: MatchIncident): void {
    const message = MESSAGES[incident.kind];
    logger.error(message, { incident: incident.kind, count: incident.count });
    // captureMessageの文言だけのイベントは、直前と同じ文言と指紋なら重複として捨てられ、翌日も続く同じ出来事を通知できない。文言をlogentryに置くと重複の判定から外れる
    captureEvent({
      level: 'error',
      logentry: { message },
      fingerprint: ['match', incident.kind],
      tags: { match_incident: incident.kind },
      contexts: { [CONTEXT_NAME]: { count: incident.count } },
    });
  }
}
