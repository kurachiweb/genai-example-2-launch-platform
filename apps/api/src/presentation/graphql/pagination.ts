import { z } from 'zod';

import { AppError } from '../../../lib/core/errors/app-error.ts';

export const MAX_PAGE_SIZE = 100;

const BASE64URL_OPTIONS = {
  alphabet: 'base64url',
  omitPadding: true,
} as const;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false });

const pageSizeSchema = z.int().min(1).max(MAX_PAGE_SIZE);

// GraphQLの省略可能な引数は明示したnullでも届くため、未指定と同じ扱いにそろえる
export const CURSOR_PAGE_ARGS = z.object({
  first: pageSizeSchema,
  after: z
    .string()
    .nullish()
    .transform((value) => value ?? undefined),
});

export const OFFSET_PAGE_ARGS = z.object({
  page: z.int().min(1),
  perPage: pageSizeSchema,
});

export type CursorPageArgs = z.output<typeof CURSOR_PAGE_ARGS>;
export type OffsetPageArgs = z.output<typeof OFFSET_PAGE_ARGS>;

export interface Connection<T> {
  readonly nodes: readonly T[];
  readonly pageInfo: {
    readonly hasNextPage: boolean;
    readonly endCursor: string | null;
  };
}

export interface OffsetPage<T> {
  readonly nodes: readonly T[];
  readonly pageInfo: {
    readonly page: number;
    readonly perPage: number;
    readonly totalCount: number;
    readonly totalPages: number;
  };
}

function invalidCursor(): AppError {
  return new AppError({
    kind: 'bad_request',
    code: 'invalid_cursor',
    message: 'ページの位置の指定が正しくありません。',
  });
}

export function encodeCursor(
  position: Readonly<Record<string, string | number>>,
): string {
  return textEncoder
    .encode(JSON.stringify(position))
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
  if (bytes.length === 0 || bytes.toBase64(BASE64URL_OPTIONS) !== cursor) {
    return undefined;
  }
  try {
    return textDecoder.decode(bytes);
  } catch {
    return undefined;
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export function decodeCursor<T>(schema: z.ZodType<T>, cursor: string): T {
  const text = decodeCursorText(cursor);
  if (text === undefined) {
    throw invalidCursor();
  }
  const result = schema.safeParse(parseJson(text));
  if (!result.success) {
    throw invalidCursor();
  }
  return result.data;
}

export function toConnection<T>(
  rows: readonly T[],
  first: number,
  cursorOf: (row: T) => string,
): Connection<T> {
  const nodes = rows.slice(0, first);
  const last = nodes.at(-1);
  return {
    nodes,
    pageInfo: {
      hasNextPage: rows.length > first,
      endCursor: last === undefined ? null : cursorOf(last),
    },
  };
}

export function toOffsetPage<T>(
  rows: readonly T[],
  totalCount: number,
  page: number,
  perPage: number,
): OffsetPage<T> {
  return {
    nodes: rows,
    pageInfo: {
      page,
      perPage,
      totalCount,
      totalPages: Math.ceil(totalCount / perPage),
    },
  };
}
