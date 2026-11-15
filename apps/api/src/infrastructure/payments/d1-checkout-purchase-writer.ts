import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type { IdGenerator } from '../../../lib/core/ids/id-generator.ts';
import { PAYMENTS_TYPES } from '../../../lib/core/payments/identifiers.ts';
import type { NewPurchase } from '../../../lib/core/payments/ports.ts';
import type { PurchaseStatements } from '../../../lib/workers/payments/statement-contracts.ts';
import type { CheckoutPurchaseWriter } from '../../application/payments/checkout-ports.ts';

@injectable()
export class D1CheckoutPurchaseWriter implements CheckoutPurchaseWriter {
  constructor(
    @inject(PLATFORM_TYPES.Database) private readonly db: Database,
    @inject(PAYMENTS_TYPES.PurchaseStatements)
    private readonly purchases: PurchaseStatements,
    @inject(PLATFORM_TYPES.IdGenerator) private readonly ids: IdGenerator,
  ) {}

  async replaceOpen(input: {
    readonly purchase: NewPurchase;
    readonly supersede: readonly string[];
  }): Promise<void> {
    // 前進ごとにstate_tokenを変え、置き換えより前に読んだ版での反映を版の検査で失敗させる
    const supersedes = input.supersede.map((purchaseId) =>
      this.purchases.advance({
        purchaseId,
        to: 'superseded',
        from: ['open'],
        nextToken: this.ids.generate(),
        patch: {},
      }),
    );
    await this.db.batch([this.purchases.create(input.purchase), ...supersedes]);
  }

  async expire(purchaseId: string): Promise<void> {
    await this.db.batch([
      this.purchases.advance({
        purchaseId,
        to: 'expired',
        from: ['open'],
        nextToken: this.ids.generate(),
        patch: {},
      }),
    ]);
  }
}
