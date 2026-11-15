import { text, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core';

import { softDelete, timestamps, ulidPrimaryKey } from '../_shared/columns.ts';
import { textNoCase } from '../_shared/text-no-case.ts';

interface PreviousHandleColumnsInput {
  readonly ownerColumnName: string;
  readonly references: () => AnySQLiteColumn;
}

// 保有者の列名は対象ごとに異なるため、列名を明示して定義する
export function previousHandleColumns(input: PreviousHandleColumnsInput) {
  return {
    id: ulidPrimaryKey(),
    ownerId: text(input.ownerColumnName)
      .notNull()
      .unique()
      .references(input.references),
    handle: textNoCase().notNull().unique(),
    ...timestamps(),
    ...softDelete(),
  } as const;
}
