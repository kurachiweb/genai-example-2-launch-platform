import { snakeCase, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

import { timestamps, ulidPrimaryKey } from '../_shared/columns.ts';
import { users } from '../identity/users.ts';

export const paymentCustomers = snakeCase.table(
  'payment_customers',
  {
    id: ulidPrimaryKey(),
    userId: text()
      .notNull()
      .references(() => users.id),
    stripeCustomerId: text().notNull(),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex('payment_customers_user_id_unique').on(table.userId),
    uniqueIndex('payment_customers_stripe_customer_id_unique').on(
      table.stripeCustomerId,
    ),
  ],
);
