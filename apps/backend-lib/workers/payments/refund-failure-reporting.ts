import type { Logger } from '@logtape/logtape';
import { captureEvent } from '@sentry/cloudflare';

export interface RefundFailure {
  readonly refundRequestId: string;
  readonly stripeRefundId: string;
  readonly failureCode: string | null;
}

const MESSAGE = '決済サービス上で返金が失敗しました';

const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/u;

const STRIPE_REFUND_ID_PATTERN = /^(?:re|pyr)_[0-9A-Za-z_]{1,255}$/u;

const FAILURE_CODE_PATTERN = /^[a-z0-9_]{1,64}$/u;

const UNSAFE_VALUE = 'unknown';

// タグは除去処理の対象外のため、識別子とコードの形の値だけを送る
const safely = (value: string | null, pattern: RegExp): string =>
  value !== null && pattern.test(value) ? value : UNSAFE_VALUE;

// 返金の失敗はStripeの通知で後から届き、利用者へ返金されないまま反映を終えるため、例外としては送られない。運営者が手動で対処できるよう知らせる
export function reportRefundFailure(
  logger: Logger,
  failure: RefundFailure,
): void {
  const tags = {
    payments_incident: 'refund-failed',
    refund_request_id: safely(failure.refundRequestId, ULID_PATTERN),
    stripe_refund_id: safely(failure.stripeRefundId, STRIPE_REFUND_ID_PATTERN),
    failure_code: safely(failure.failureCode, FAILURE_CODE_PATTERN),
  };
  logger.error(MESSAGE, {
    refundRequestId: tags.refund_request_id,
    stripeRefundId: tags.stripe_refund_id,
    failureCode: tags.failure_code,
  });
  // captureMessageの文言だけのイベントは、直前と同じ文言と指紋なら重複として捨てられ、続けて失敗した返金を通知できない。文言をlogentryに置くと重複の判定から外れる
  captureEvent({
    level: 'error',
    logentry: { message: MESSAGE },
    fingerprint: ['payments', 'refund-failed'],
    tags,
  });
}
