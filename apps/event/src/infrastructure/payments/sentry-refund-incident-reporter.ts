import { captureEvent } from '@sentry/cloudflare';
import { injectable } from 'inversify';

import { getAppLogger } from '../../../lib/core/logging/app-logger.ts';
import { PAYMENTS_REFUND_MESSAGE } from '../../../lib/core/payments/refund-message.ts';
import type {
  RefundIncident,
  RefundIncidentKind,
  RefundIncidentReporter,
} from '../../application/payments/refund-incidents.ts';

interface IncidentDetails {
  readonly fingerprint: readonly string[];
  readonly tags: Readonly<Record<string, string>>;
}

const MESSAGES: Readonly<Record<RefundIncidentKind, string>> = {
  'stripe-rejected': 'Stripeが返金の処理を拒否しました',
  'missing-payment-intent':
    '返金に要る支払いの識別子が無い返金の依頼があります',
  'stripe-refund-failed': '作成済みの返金がStripe上で失敗していました',
};

const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/u;

const STRIPE_ERROR_CODE_PATTERN = /^[a-z0-9_]{1,64}$/u;

const STRIPE_REFUND_ID_PATTERN = /^(?:re|pyr)_[0-9A-Za-z_]{1,255}$/u;

const UNSAFE_VALUE = 'unknown';

const logger = getAppLogger(['event', 'payments', 'refund-incident']);

// タグと指紋は除去処理の対象外のため、識別子と拒否のコードの形の値だけを送り、メールアドレスなどが紛れ込まないようにする
const toId = (id: string): string =>
  ULID_PATTERN.test(id) ? id : UNSAFE_VALUE;

const toStripeErrorCode = (code: string | null): string =>
  code !== null && STRIPE_ERROR_CODE_PATTERN.test(code) ? code : UNSAFE_VALUE;

const toStripeRefundId = (id: string): string =>
  STRIPE_REFUND_ID_PATTERN.test(id) ? id : UNSAFE_VALUE;

function detailsOf(incident: RefundIncident): IncidentDetails {
  const base = {
    message_type: PAYMENTS_REFUND_MESSAGE.type,
    payments_incident: incident.kind,
    refund_request_id: toId(incident.refundRequestId),
  };
  switch (incident.kind) {
    case 'stripe-rejected': {
      const stripeErrorCode = toStripeErrorCode(incident.stripeErrorCode);
      return {
        fingerprint: [
          'payments',
          incident.kind,
          incident.operation,
          stripeErrorCode,
        ],
        tags: {
          ...base,
          stripe_operation: incident.operation,
          stripe_error_code: stripeErrorCode,
        },
      };
    }
    case 'missing-payment-intent':
      return { fingerprint: ['payments', incident.kind], tags: base };
    case 'stripe-refund-failed':
      return {
        fingerprint: ['payments', incident.kind],
        tags: {
          ...base,
          stripe_refund_id: toStripeRefundId(incident.stripeRefundId),
          failure_code: toStripeErrorCode(incident.failureCode),
        },
      };
  }
}

@injectable()
export class SentryRefundIncidentReporter implements RefundIncidentReporter {
  report(incident: RefundIncident): void {
    const message = MESSAGES[incident.kind];
    const { fingerprint, tags } = detailsOf(incident);
    logger.error(message, {
      incident: incident.kind,
      refundRequestId: tags.refund_request_id,
      ...(tags.stripe_operation === undefined
        ? {}
        : {
            operation: tags.stripe_operation,
            stripeErrorCode: tags.stripe_error_code,
          }),
      ...(tags.stripe_refund_id === undefined
        ? {}
        : {
            stripeRefundId: tags.stripe_refund_id,
            failureCode: tags.failure_code,
          }),
    });
    // captureMessageの文言だけのイベントは、直前と同じ文言と指紋なら重複として捨てられ、続けて拒否された返金を通知できない。文言をlogentryに置くと重複の判定から外れる
    captureEvent({
      level: 'error',
      logentry: { message },
      fingerprint: [...fingerprint],
      tags: { ...tags },
    });
  }
}
