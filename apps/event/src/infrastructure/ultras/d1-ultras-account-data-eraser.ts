import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import { ULTRAS_TYPES } from '../../../lib/core/ultras/identifiers.ts';
import type {
  ActivationStatements,
  NoticeStatements,
  SubscriptionStatements,
} from '../../../lib/workers/ultras/statement-contracts.ts';
import type { UltrasAccountDataEraser } from '../../application/ultras/ultras-account-data-eraser.ts';

@injectable()
export class D1UltrasAccountDataEraser implements UltrasAccountDataEraser {
  constructor(
    @inject(PLATFORM_TYPES.Database) private readonly db: Database,
    @inject(ULTRAS_TYPES.NoticeStatements)
    private readonly notices: NoticeStatements,
    @inject(ULTRAS_TYPES.ActivationStatements)
    private readonly activations: ActivationStatements,
    @inject(ULTRAS_TYPES.SubscriptionStatements)
    private readonly subscriptions: SubscriptionStatements,
  ) {}

  // 3テーブルは利用者だけを参照し互いを参照しないが、加入に紐づく記録から順に消す
  async erase(userId: string): Promise<void> {
    await this.db.batch([
      this.notices.deleteByUser(userId),
      this.activations.deleteByUser(userId),
      this.subscriptions.deleteByUser(userId),
    ]);
  }
}
