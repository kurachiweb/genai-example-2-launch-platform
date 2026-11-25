import { captureEvent } from '@sentry/cloudflare';
import { injectable } from 'inversify';

import { getAppLogger } from '../../../lib/core/logging/app-logger.ts';
import type {
  ModerationIncident,
  ModerationIncidentContext,
  ModerationIncidentReporter,
} from '../../application/moderation/ports.ts';

const MESSAGES: Readonly<Record<ModerationIncident, string>> = {
  'moderation-record-missing':
    '状態を変えた措置の記録と監査ログが、同期の処理で確定されませんでした',
  'statistics-failed': '週ごとの統計の集計に失敗しました',
  'notice-redispatch-failed': '措置の通知の送り直しに失敗したものがあります',
};

const CONTEXT_NAME = 'moderation_incident';

const logger = getAppLogger(['api', 'infrastructure', 'moderation']);

@injectable()
export class SentryModerationIncidentReporter implements ModerationIncidentReporter {
  report(
    incident: ModerationIncident,
    { job, count }: ModerationIncidentContext,
  ): void {
    const message = MESSAGES[incident];
    logger.error(message, { incident, job, count });
    // captureMessageの文言だけのイベントは、直前と同じ文言と指紋なら重複として捨てられ、翌日も続く同じ出来事を通知できない。文言をlogentryに置くと重複の判定から外れる
    captureEvent({
      level: 'error',
      logentry: { message },
      fingerprint: ['moderation', incident],
      tags: {
        moderation_incident: incident,
        ...(job === undefined ? {} : { job }),
      },
      ...(count === undefined
        ? {}
        : { contexts: { [CONTEXT_NAME]: { count } } }),
    });
  }
}
