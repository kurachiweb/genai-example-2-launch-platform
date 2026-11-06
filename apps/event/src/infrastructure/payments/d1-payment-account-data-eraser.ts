import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import { PAYMENTS_TYPES } from '../../../lib/core/payments/identifiers.ts';
import type {
  CustomerStatements,
  PurchaseStatements,
  RefundStatements,
} from '../../../lib/workers/payments/statement-contracts.ts';
import type { PaymentAccountDataEraser } from '../../application/payments/payment-account-data-eraser.ts';

@injectable()
export class D1PaymentAccountDataEraser implements PaymentAccountDataEraser {
  constructor(
    @inject(PLATFORM_TYPES.Database) private readonly db: Database,
    @inject(PAYMENTS_TYPES.RefundStatements)
    private readonly refunds: RefundStatements,
    @inject(PAYMENTS_TYPES.PurchaseStatements)
    private readonly purchases: PurchaseStatements,
    @inject(PAYMENTS_TYPES.CustomerStatements)
    private readonly customers: CustomerStatements,
  ) {}

  // 外部キーにON DELETEの動作を指定していないため、返金の依頼・購入・Customerの対応の順に消す
  async erase(userId: string): Promise<void> {
    await this.db.batch([
      this.refunds.deleteByUser(userId),
      this.purchases.deleteByUser(userId),
      this.customers.deleteByUser(userId),
    ]);
  }
}
