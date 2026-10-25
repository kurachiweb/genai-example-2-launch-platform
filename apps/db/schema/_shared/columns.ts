import { isNull, type SQL } from 'drizzle-orm';
import { integer, text, type SQLiteColumn } from 'drizzle-orm/sqlite-core';
import { ulid } from 'ulid';

const now = (): Date => new Date();

const timestampMs = () => integer({ mode: 'timestamp_ms' });

export function ulidPrimaryKey() {
  return text()
    .primaryKey()
    .$defaultFn(() => ulid());
}

export function timestamps() {
  return {
    createdAt: timestampMs().notNull().$defaultFn(now),
    updatedAt: timestampMs().notNull().$defaultFn(now).$onUpdateFn(now),
  } as const;
}

export function softDelete() {
  return {
    deletedAt: timestampMs(),
  } as const;
}

export function notDeleted(deletedAt: SQLiteColumn): SQL {
  return isNull(deletedAt);
}
