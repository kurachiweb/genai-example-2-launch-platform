import { captureEvent } from '@sentry/cloudflare';
import { injectable } from 'inversify';

import { getAppLogger } from '../../../lib/core/logging/app-logger.ts';
import type {
  ProductIncident,
  ProductIncidentReporter,
} from '../../application/product/ports.ts';

type IncidentKind = ProductIncident['kind'];

interface IncidentDetails {
  readonly context: Readonly<Record<string, unknown>>;
  readonly logProperties: Readonly<Record<string, unknown>>;
}

const MESSAGES: Readonly<Record<IncidentKind, string>> = {
  'product-purge-overdue': '物理削除の期限を過ぎたプロダクトが残っています',
  'product-lifecycle-events-redispatched':
    '送り直しが3回目以降に達したプロダクトライフサイクルイベントがあります',
};

const EVENT_ID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/u;

const UNSAFE_VALUE = 'unknown';

const CONTEXT_NAME = 'product_incident';

const logger = getAppLogger(['api', 'infrastructure', 'product']);

// タグ・コンテキスト・指紋は除去処理の対象外のため、分類の値と識別子の形の値だけを送る
const toEventId = (eventId: string): string =>
  EVENT_ID_PATTERN.test(eventId) ? eventId : UNSAFE_VALUE;

function detailsOf(incident: ProductIncident): IncidentDetails {
  switch (incident.kind) {
    case 'product-purge-overdue':
      return {
        context: { count: incident.count },
        logProperties: { count: incident.count },
      };
    case 'product-lifecycle-events-redispatched': {
      const stuckEventIds = incident.stuckEventIds.map(toEventId);
      return {
        context: { count: incident.count, stuck_event_ids: stuckEventIds },
        logProperties: { count: incident.count, stuckEventIds },
      };
    }
  }
}

@injectable()
export class SentryProductIncidentReporter implements ProductIncidentReporter {
  report(incident: ProductIncident): void {
    const message = MESSAGES[incident.kind];
    const { context, logProperties } = detailsOf(incident);
    logger.error(message, { incident: incident.kind, ...logProperties });
    // captureMessageの文言だけのイベントは、直前と同じ文言と指紋なら重複として捨てられ、翌日も続く同じ出来事を通知できない。文言をlogentryに置くと重複の判定から外れる
    captureEvent({
      level: 'error',
      logentry: { message },
      fingerprint: ['product', incident.kind],
      tags: { product_incident: incident.kind },
      contexts: { [CONTEXT_NAME]: { ...context } },
    });
  }
}
