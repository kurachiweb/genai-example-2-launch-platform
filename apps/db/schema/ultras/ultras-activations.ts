import {
  index,
  integer,
  snakeCase,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

import { timestamps, ulidPrimaryKey } from '../_shared/columns.ts';
import { users } from '../identity/users.ts';

export const ultrasActivations = snakeCase.table(
  'ultras_activations',
  {
    id: ulidPrimaryKey(),
    userId: text()
      .notNull()
      .references(() => users.id),
    stripeSubscriptionId: text().notNull(),
    activatedAt: integer({ mode: 'timestamp_ms' }).notNull(),
    dispatchedAt: integer({ mode: 'timestamp_ms' }),
    completedAt: integer({ mode: 'timestamp_ms' }),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex('ultras_activations_stripe_subscription_id_unique').on(
      table.stripeSubscriptionId,
    ),
    index('ultras_activations_completed_at_dispatched_at_created_at_idx').on(
      table.completedAt,
      table.dispatchedAt,
      table.createdAt,
    ),
  ],
);
