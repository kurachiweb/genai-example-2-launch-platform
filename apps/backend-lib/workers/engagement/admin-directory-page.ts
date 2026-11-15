import { and, eq, lt, or, type SQL } from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';

import type { AdminDirectoryPage } from '../../core/engagement/ports.ts';
import { AppError } from '../../core/errors/app-error.ts';
import { invalidCursorError } from '../../core/errors/invalid-cursor.ts';

const MIN_PAGE_SIZE = 1;
const MAX_PAGE_SIZE = 100;

const CURSOR_PATTERN = /^(\d{1,15}):([0-9A-Z]{26})$/u;

const BASE64URL_OPTIONS = {
  alphabet: 'base64url',
  omitPadding: true,
} as const;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false });

interface PagePosition {
  readonly at: Date;
  readonly id: string;
}

// 並びの日時とIDの降順の続きを読む列
export interface PageOrderColumns {
  readonly at: SQLiteColumn;
  readonly id: SQLiteColumn;
}

export function assertPageSize(limit: number): void {
  if (
    !Number.isInteger(limit) ||
    limit < MIN_PAGE_SIZE ||
    limit > MAX_PAGE_SIZE
  ) {
    throw new AppError({
      kind: 'bad_request',
      code: 'validation_error',
      message: `取得する件数は${String(MIN_PAGE_SIZE)}〜${String(MAX_PAGE_SIZE)}の整数で指定してください。`,
    });
  }
}

function encodeCursor(position: PagePosition): string {
  return textEncoder
    .encode(`${String(position.at.getTime())}:${position.id}`)
    .toBase64(BASE64URL_OPTIONS);
}

function decodeCursorText(cursor: string): string | undefined {
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.fromBase64(cursor, { alphabet: 'base64url' });
  } catch {
    return undefined;
  }
  // デコードは空白・パディング・末尾の余りのビットを許すため、再エンコードして同じ表記のものだけを受け付ける
  if (bytes.toBase64(BASE64URL_OPTIONS) !== cursor) {
    return undefined;
  }
  try {
    return textDecoder.decode(bytes);
  } catch {
    return undefined;
  }
}

function decodeCursor(cursor: string): PagePosition {
  const text = decodeCursorText(cursor);
  const [, at, id] = CURSOR_PATTERN.exec(text ?? '') ?? [];
  if (at === undefined || id === undefined) {
    throw invalidCursorError();
  }
  return { at: new Date(Number(at)), id };
}

export function afterCursor(
  columns: PageOrderColumns,
  cursor: string | undefined,
): SQL | undefined {
  if (cursor === undefined) {
    return undefined;
  }
  const position = decodeCursor(cursor);
  return or(
    lt(columns.at, position.at),
    and(eq(columns.at, position.at), lt(columns.id, position.id)),
  );
}

// 件数の上限より1件多く読んだ行から、ページの行と続きのカーソルを決める
export function toPage<T>(
  rows: readonly T[],
  page: AdminDirectoryPage,
  positionOf: (row: T) => PagePosition,
): { readonly rows: readonly T[]; readonly nextCursor: string | null } {
  const pageRows = rows.slice(0, page.limit);
  const last = pageRows.at(-1);
  return {
    rows: pageRows,
    nextCursor:
      rows.length > page.limit && last !== undefined
        ? encodeCursor(positionOf(last))
        : null,
  };
}
