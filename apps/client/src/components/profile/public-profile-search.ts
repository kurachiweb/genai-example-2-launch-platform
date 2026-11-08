import { z } from '../../../lib/utilities/validation/zod.ts';

export const PROFILE_TAB_ID_PATTERN = /^[a-z][a-z0-9-]*$/u;

const PROFILE_TAB_ID_MAX = 64;

export interface PublicProfileSearch {
  readonly tab?: string | undefined;
}

const SEARCH_SCHEMA = z.object({
  tab: z
    .string()
    .max(PROFILE_TAB_ID_MAX)
    .regex(PROFILE_TAB_ID_PATTERN)
    .optional()
    .catch(undefined),
});

// 共有されたURLや手で書き換えたURLの不正な値は欠落と同じに扱い、未登録の識別子は表示側が既定のタブにする。ルーターは検証の結果をURLの元の値に重ねるため、元の値を残さないよう常に項目を返す
export const toPublicProfileSearch = (
  search: Record<string, unknown>,
): PublicProfileSearch => ({ tab: SEARCH_SCHEMA.parse(search).tab });
