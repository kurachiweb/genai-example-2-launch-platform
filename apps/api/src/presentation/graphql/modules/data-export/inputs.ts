import { z } from 'zod';

import { DATA_EXPORT_LIST_PAGE_SIZE } from '../../../../../common-lib/data-export/data-export-rules.ts';
import { UPPERCASE_ULID_PATTERN } from '../../../../../lib/core/ids/uppercase-ulid.ts';
import { decodeCursor } from '../../../../../lib/core/pagination/opaque-cursor.ts';

const FIRST_OUT_OF_RANGE_MESSAGE = `表示する件数は1〜${String(DATA_EXPORT_LIST_PAGE_SIZE)}件の整数で指定してください。`;

const DataExportPositionSchema = z.object({
  id: z.ulid().regex(UPPERCASE_ULID_PATTERN),
});

// 基盤のCURSOR_PAGE_ARGSは1〜100件のため、1ページの件数の上限を狭めて組み立てる。
// GraphQLの省略可能な引数は明示したnullでも届くため、未指定と同じ扱いにそろえる。空文字列は未指定ではなく不正なカーソルとして扱う
export const MY_DATA_EXPORTS_ARGS = z.object({
  first: z
    .int(FIRST_OUT_OF_RANGE_MESSAGE)
    .min(1, FIRST_OUT_OF_RANGE_MESSAGE)
    .max(DATA_EXPORT_LIST_PAGE_SIZE, FIRST_OUT_OF_RANGE_MESSAGE),
  after: z
    .string()
    .nullish()
    .transform((value) => value ?? undefined),
});

export function afterIdOf(cursor: string | undefined): string | undefined {
  return cursor === undefined
    ? undefined
    : decodeCursor(DataExportPositionSchema, cursor).id;
}
