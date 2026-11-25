import { captureEvent } from '@sentry/cloudflare';

import { isUppercaseUlid } from '../../core/ids/uppercase-ulid.ts';
import { getAppLogger } from '../../core/logging/app-logger.ts';
import type { RefundRejectionCode } from '../../core/payments/refund-rejection.ts';
import type { RefundKind } from '../../core/sponsorship/ports.ts';
import type { LoggingOptions } from '../logging/configure-logging.ts';

export type SponsorshipIncident = 'refund-already-settled' | 'refund-rejected';

// 理由の形式違反でpaymentsが投げるRangeErrorは、拒否のコードを持たないためinvalid_reasonで表す
export type SponsorshipIncidentCode = RefundRejectionCode | 'invalid_reason';

export interface SponsorshipIncidentReport {
  readonly appName: LoggingOptions['appName'];
  readonly incident: SponsorshipIncident;
  readonly sponsorshipId: string;
  readonly refundKind: RefundKind;
  readonly code: SponsorshipIncidentCode;
}

const MESSAGES: Readonly<Record<SponsorshipIncident, string>> = Object.freeze({
  'refund-already-settled':
    '返金できる残額が無いスポンサー広告の返金の依頼を、返金済みとして終えました',
  'refund-rejected':
    '形式の誤りで拒否されたスポンサー広告の返金の依頼を、再処理の対象から外しました',
});

const UNSAFE_VALUE = 'unknown';

// タグは除去処理の対象外のため、識別子の形の値だけを送る
const safeIdOf = (value: string): string =>
  isUppercaseUlid(value) ? value : UNSAFE_VALUE;

export function reportSponsorshipIncident(
  report: SponsorshipIncidentReport,
): void {
  const { incident } = report;
  const message = MESSAGES[incident];
  const sponsorshipId = safeIdOf(report.sponsorshipId);
  const properties = {
    incident,
    sponsorshipId,
    refundKind: report.refundKind,
    code: report.code,
  };
  const logger = getAppLogger([report.appName, 'sponsorship', 'refund']);
  const alreadySettled = incident === 'refund-already-settled';
  if (alreadySettled) {
    logger.warn(message, properties);
  } else {
    logger.error(message, properties);
  }
  // captureMessageの文言だけのイベントは、直前と同じ文言と指紋なら重複として捨てられる。文言をlogentryに置くと重複の判定から外れる
  captureEvent({
    level: alreadySettled ? 'warning' : 'error',
    logentry: { message },
    fingerprint: ['sponsorship', incident],
    tags: {
      sponsorship_incident: incident,
      sponsorship_id: sponsorshipId,
      refund_kind: report.refundKind,
      refund_code: report.code,
    },
  });
}
