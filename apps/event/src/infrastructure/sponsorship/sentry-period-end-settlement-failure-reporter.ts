import { captureException } from '@sentry/cloudflare';
import { injectable } from 'inversify';

import { isUppercaseUlid } from '../../../lib/core/ids/uppercase-ulid.ts';
import { getAppLogger } from '../../../lib/core/logging/app-logger.ts';
import { SPONSORSHIP_SETTLE_PERIOD_END_MESSAGE } from '../../../lib/core/messaging/contracts/sponsorship.ts';
import type {
  PeriodEndSettlementFailure,
  PeriodEndSettlementFailureReporter,
} from '../../application/sponsorship/ports.ts';

const UNSAFE_VALUE = 'unknown';

const logger = getAppLogger(['event', 'sponsorship']);

// タグは除去処理の対象外のため、識別子の形の値だけを送る
const safeIdOf = (value: string): string =>
  isUppercaseUlid(value) ? value : UNSAFE_VALUE;

@injectable()
export class SentryPeriodEndSettlementFailureReporter implements PeriodEndSettlementFailureReporter {
  report({ sponsorshipId, error }: PeriodEndSettlementFailure): void {
    const safeId = safeIdOf(sponsorshipId);
    logger.error('スポンサー広告の掲載の終わりの精算に失敗しました', {
      sponsorshipId: safeId,
      error,
    });
    captureException(error, {
      tags: {
        message_type: SPONSORSHIP_SETTLE_PERIOD_END_MESSAGE.type,
        sponsorship_id: safeId,
      },
    });
  }
}
