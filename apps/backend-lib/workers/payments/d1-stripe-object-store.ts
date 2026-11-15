import { eq, sql } from 'drizzle-orm';
import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { paymentStripeObjects } from '../../../db/schema/payments/payment-stripe-objects.ts';
import { PLATFORM_TYPES } from '../../core/di/identifiers.ts';
import type { StripeObjectStore } from '../../core/payments/ports.ts';
import type {
  GuardedStatement,
  StripeObjectStatements,
} from './statement-contracts.ts';

const objects = paymentStripeObjects;

@injectable()
export class D1StripeObjectStore
  implements StripeObjectStore, StripeObjectStatements
{
  constructor(@inject(PLATFORM_TYPES.Database) private readonly db: Database) {}

  async findLastEventAt(objectId: string): Promise<Date | undefined> {
    const [row] = await this.db
      .select({ lastEventAt: objects.lastEventAt })
      .from(objects)
      .where(eq(objects.objectId, objectId))
      .limit(1);
    return row?.lastEventAt;
  }

  // より新しい発生時刻が記録済みなら最後の発生時刻がNULLになり、NOT NULL制約の違反で一括の書き込み全体が取り消される。NOT NULLはupsertの衝突の判定より先に確かめられる
  advanceGuarded(input: {
    readonly objectId: string;
    readonly objectType: 'subscription';
    readonly occurredAt: Date;
  }): GuardedStatement {
    const occurredAtMs = input.occurredAt.getTime();
    const newerRecorded = sql`EXISTS (SELECT 1 FROM ${objects} WHERE ${objects.objectId} = ${input.objectId} AND ${objects.lastEventAt} > ${occurredAtMs})`;
    return {
      statement: this.db
        .insert(objects)
        .values({
          objectId: input.objectId,
          objectType: input.objectType,
          lastEventAt: sql`CASE WHEN ${newerRecorded} THEN NULL ELSE ${occurredAtMs} END`,
        })
        .onConflictDoUpdate({
          target: objects.objectId,
          set: {
            lastEventAt: sql`excluded.${sql.identifier(objects.lastEventAt.name)}`,
          },
        }),
      guardColumn: 'payment_stripe_objects.last_event_at',
    };
  }
}
