import { and, eq, lt, or, type SQL } from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';

import { decodeInquiryCursor, encodeInquiryCursor } from './inquiry-cursor.ts';

export interface InquiryPageKeys {
  readonly createdAt: SQLiteColumn;
  readonly id: SQLiteColumn;
}

export interface InquiryPage<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
}

// (created_at DESC, id DESC)の並びで、カーソルの位置より後ろの行だけにする
export function afterInquiryCursor(
  keys: InquiryPageKeys,
  cursor: string | undefined,
): SQL | undefined {
  if (cursor === undefined) {
    return undefined;
  }
  const position = decodeInquiryCursor(cursor);
  return or(
    lt(keys.createdAt, position.at),
    and(eq(keys.createdAt, position.at), lt(keys.id, position.id)),
  );
}

// 1件多く読んだ行から、上限までの行と、続きがあるときだけ最後の行の位置のカーソルを返す
export function inquiryPageOf<
  T extends { readonly createdAt: Date; readonly id: string },
>(rows: readonly T[], limit: number): InquiryPage<T> {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return {
    items,
    nextCursor:
      rows.length > limit && last !== undefined
        ? encodeInquiryCursor({ at: last.createdAt, id: last.id })
        : null,
  };
}
