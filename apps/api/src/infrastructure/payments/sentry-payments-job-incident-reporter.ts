import { captureEvent, type SeverityLevel } from '@sentry/cloudflare';
import { injectable } from 'inversify';

import { getAppLogger } from '../../../lib/core/logging/app-logger.ts';
import type {
  PaymentsJobIncident,
  PaymentsJobIncidentKind,
  PaymentsJobIncidentReporter,
} from '../../application/payments/jobs/payments-job-incidents.ts';

interface IncidentDetails {
  readonly tags: Readonly<Record<string, string>>;
  readonly context?: Readonly<Record<string, unknown>>;
  readonly logProperties: Readonly<Record<string, unknown>>;
}

const LEVELS: Readonly<Record<PaymentsJobIncidentKind, SeverityLevel>> = {
  'reconciliation-failed': 'error',
  'refund-dispatch-failed': 'error',
  'notice-request-failed': 'warning',
};

const MESSAGES: Readonly<Record<PaymentsJobIncidentKind, string>> = {
  'reconciliation-failed': '決済セッションとの突合に失敗した購入があります',
  'refund-dispatch-failed': '返金の依頼を送り直せませんでした',
  'notice-request-failed':
    '依頼待ちのまま依頼できなかった決済のメールがあります',
};

const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/u;

const ERROR_NAME_PATTERN = /^[A-Za-z]{1,64}$/u;

const UNSAFE_VALUE = 'unknown';

const CONTEXT_NAME = 'payments_incident';

const logger = getAppLogger(['api', 'payments', 'job-incident']);

// タグ・コンテキスト・指紋は除去処理の対象外のため、分類の値と識別子の形の値だけを送り、メールアドレスなどが紛れ込まないようにする
const toId = (id: string): string =>
  ULID_PATTERN.test(id) ? id : UNSAFE_VALUE;

// 例外のメッセージは利用者の情報を含み得るため、タグには例外の名前だけを入れ、メッセージはログ(伏せ字の対象)に残す
const toErrorName = (error: unknown): string =>
  error instanceof Error && ERROR_NAME_PATTERN.test(error.name)
    ? error.name
    : UNSAFE_VALUE;

function detailsOf(incident: PaymentsJobIncident): IncidentDetails {
  const base = { job: incident.job, payments_incident: incident.kind };
  switch (incident.kind) {
    case 'reconciliation-failed': {
      const purchaseId = toId(incident.purchaseId);
      return {
        tags: {
          ...base,
          purchase_id: purchaseId,
          error_name: toErrorName(incident.error),
        },
        logProperties: { purchaseId, error: incident.error },
      };
    }
    case 'refund-dispatch-failed': {
      const refundRequestId = toId(incident.refundRequestId);
      return {
        tags: {
          ...base,
          refund_request_id: refundRequestId,
          error_name: toErrorName(incident.error),
        },
        logProperties: { refundRequestId, error: incident.error },
      };
    }
    case 'notice-request-failed': {
      const purchaseIds = incident.purchaseIds.map(toId);
      const refundRequestIds = incident.refundRequestIds.map(toId);
      return {
        tags: base,
        context: {
          count: purchaseIds.length + refundRequestIds.length,
          purchase_ids: purchaseIds,
          refund_request_ids: refundRequestIds,
        },
        logProperties: { purchaseIds, refundRequestIds },
      };
    }
  }
}

@injectable()
export class SentryPaymentsJobIncidentReporter implements PaymentsJobIncidentReporter {
  report(incident: PaymentsJobIncident): void {
    const level = LEVELS[incident.kind];
    const message = MESSAGES[incident.kind];
    const { tags, context, logProperties } = detailsOf(incident);
    const properties = {
      incident: incident.kind,
      job: incident.job,
      ...logProperties,
    };
    if (level === 'error') {
      logger.error(message, properties);
    } else {
      logger.warn(message, properties);
    }
    // captureMessageの文言だけのイベントは、直前と同じ文言と指紋なら重複として捨てられ、続けて失敗した購入を通知できない。文言をlogentryに置くと重複の判定から外れる
    captureEvent({
      level,
      logentry: { message },
      fingerprint: ['payments', incident.kind, incident.job],
      tags: { ...tags },
      ...(context === undefined
        ? {}
        : { contexts: { [CONTEXT_NAME]: { ...context } } }),
    });
  }
}
