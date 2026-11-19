import { z } from 'zod';

export {
  decodeCursor,
  encodeCursor,
} from '../../../lib/core/pagination/opaque-cursor.ts';

export const MAX_PAGE_SIZE = 100;

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
