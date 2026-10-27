import { inject, injectable } from 'inversify';

import { EMAIL_TYPES } from '../../../lib/core/email/identifiers.ts';
import type { SuppressionMaintenance } from '../../../lib/core/email/ports.ts';
import { getAppLogger } from '../../../lib/core/logging/app-logger.ts';
import type {
  ScheduledJobContext,
  ScheduledJobHandler,
} from '../../../lib/core/scheduling/cron-registry.ts';

const EMAIL_CLEANUP_JOB: unique symbol = Symbol.for('email.EmailCleanupJob');

export const API_EMAIL_TYPES = Object.freeze({
  EmailCleanupJob: EMAIL_CLEANUP_JOB,
});

const logger = getAppLogger(['api', 'application', 'email-cleanup']);

@injectable()
export class EmailCleanupJob implements ScheduledJobHandler {
  constructor(
    @inject(EMAIL_TYPES.SuppressionMaintenance)
    private readonly maintenance: SuppressionMaintenance,
  ) {}

  async run({ scheduledTime }: ScheduledJobContext): Promise<void> {
    const summary = await this.maintenance.runDailyCleanup(scheduledTime);
    logger.info('抑止記録と送信済みの記録の日次の後始末を終えました', {
      ...summary,
    });
  }
}
