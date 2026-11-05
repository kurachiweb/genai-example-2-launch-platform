import { eq } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { paymentCustomers } from '../../../db/schema/payments/payment-customers.ts';
import { PLATFORM_TYPES } from '../../core/di/identifiers.ts';
import type {
  CustomerDirectory,
  CustomerStore,
} from '../../core/payments/ports.ts';
import type { CustomerStatements } from './statement-contracts.ts';

const customers = paymentCustomers;

@injectable()
export class D1CustomerStore
  implements CustomerStore, CustomerDirectory, CustomerStatements
{
  constructor(@inject(PLATFORM_TYPES.Database) private readonly db: Database) {}

  async find(userId: string): Promise<string | undefined> {
    const [row] = await this.db
      .select({ customerId: customers.stripeCustomerId })
      .from(customers)
      .where(eq(customers.userId, userId))
      .limit(1);
    return row?.customerId;
  }

  async findCustomerId(userId: string): Promise<string | undefined> {
    return this.find(userId);
  }

  async save(userId: string, customerId: string): Promise<void> {
    await this.db
      .insert(customers)
      .values({ userId, stripeCustomerId: customerId })
      .onConflictDoUpdate({
        target: customers.userId,
        set: { stripeCustomerId: customerId },
      });
  }

  deleteByUser(userId: string): BatchItem<'sqlite'> {
    return this.db.delete(customers).where(eq(customers.userId, userId));
  }
}
