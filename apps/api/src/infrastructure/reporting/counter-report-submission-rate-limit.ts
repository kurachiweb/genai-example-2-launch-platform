import { inject, injectable } from 'inversify';

import type { KeyedHasher } from '../../../lib/core/crypto/keyed-hasher.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import { getAppLogger } from '../../../lib/core/logging/app-logger.ts';
import type { CounterRule } from '../../../lib/core/rate-limit/fixed-window.ts';
import { hashRateLimitKey } from '../../../lib/core/rate-limit/rate-limit-key.ts';
import type { RateLimitCounterClient } from '../../../lib/workers/rate-limit/rate-limit-counter-client.ts';
import type {
  ReportSubmissionRateLimit,
  ReportSubmitter,
} from '../../application/reporting/ports.ts';

export const REPORT_IP_RATE_RULE = Object.freeze({
  name: 'report:ip',
  limit: 10,
  windowSeconds: 3600,
} as const satisfies CounterRule);

export const REPORT_USER_RATE_RULE = Object.freeze({
  name: 'report:user',
  limit: 10,
  windowSeconds: 3600,
} as const satisfies CounterRule);

const IP_KEY_PURPOSE = 'report';

const USER_KEY_PURPOSE = 'report-user';

const logger = getAppLogger(['api', 'reporting', 'submission-rate-limit']);

@injectable()
export class CounterReportSubmissionRateLimit implements ReportSubmissionRateLimit {
  constructor(
    @inject(PLATFORM_TYPES.RateLimitCounterClient)
    private readonly counters: RateLimitCounterClient,
    @inject(PLATFORM_TYPES.KeyedHasher)
    private readonly hasher: KeyedHasher,
  ) {}

  async consume(
    submitter: ReportSubmitter,
    clientIp: string | undefined,
    now: Date,
  ): Promise<void> {
    // 利用者の規則で拒否した通報をIPアドレスの規則で数えないよう、利用者の規則を先に確かめる
    if (submitter.kind === 'member') {
      await this.hit(
        REPORT_USER_RATE_RULE,
        USER_KEY_PURPOSE,
        submitter.userId,
        now,
      );
    }
    // 不明なIPアドレスを1つのキーで数えると無関係な通報までまとめて止まるため、数えずにbot判定と利用者の規則で守る
    if (clientIp === undefined || clientIp === '') {
      logger.warn(
        '送信元IPアドレスが不明なため、通報の送信回数を数えませんでした',
        { reason: 'report-ip-missing' },
      );
      return;
    }
    await this.hit(REPORT_IP_RATE_RULE, IP_KEY_PURPOSE, clientIp, now);
  }

  private async hit(
    rule: CounterRule,
    purpose: string,
    value: string,
    now: Date,
  ): Promise<void> {
    const key = await hashRateLimitKey(this.hasher, purpose, value);
    const decision = await this.counters.hit(rule, key);
    this.counters.assertWithinLimit(decision, now.getTime());
  }
}
