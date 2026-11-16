import {
  index,
  integer,
  snakeCase,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

import { timestamps, ulidPrimaryKey } from '../_shared/columns.ts';
import { users } from '../identity/users.ts';
import { productLaunches } from '../product/product-launches.ts';
import { products } from '../product/products.ts';
import { tournamentBrackets } from './tournament-brackets.ts';

export const bracketParticipants = snakeCase.table(
  'bracket_participants',
  {
    id: ulidPrimaryKey(),
    bracketId: text()
      .notNull()
      .references(() => tournamentBrackets.id),
    participantNo: integer().notNull(),
    // 種類ごとの参加の枠の表を指すため外部キーにしない
    entryRef: text().notNull(),
    launchId: text().references(() => productLaunches.id),
    productId: text().references(() => products.id),
    ownerUserId: text().references(() => users.id),
    eliminatedRound: integer(),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex('bracket_participants_bracket_id_participant_no_unique').on(
      table.bracketId,
      table.participantNo,
    ),
    uniqueIndex('bracket_participants_bracket_id_entry_ref_unique').on(
      table.bracketId,
      table.entryRef,
    ),
    index('bracket_participants_product_id_idx').on(table.productId),
  ],
);
