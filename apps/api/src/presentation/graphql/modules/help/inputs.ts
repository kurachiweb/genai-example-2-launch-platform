import { z } from 'zod';

import { HELP_REORDER_MAX } from '../../../../../common-lib/help/help-input-rules.ts';
import { INPUT_MESSAGES } from './errors.ts';

// カテゴリ・記事のIDは26文字のULIDで、一致しない値はユースケースが見つからないとして扱う。ここでは処理量だけを抑える
const ID_INPUT_MAX_LENGTH = 64;

const categoryId = z
  .string()
  .max(ID_INPUT_MAX_LENGTH, INPUT_MESSAGES.categoryNotFound);

const orderedIds = z
  .array(z.string().max(ID_INPUT_MAX_LENGTH, INPUT_MESSAGES.orderInvalid))
  .min(1, INPUT_MESSAGES.orderInvalid)
  .max(HELP_REORDER_MAX, INPUT_MESSAGES.orderInvalid)
  .refine(
    (ids) => new Set(ids).size === ids.length,
    INPUT_MESSAGES.orderInvalid,
  );

// カテゴリ名の規則と前後の空白の除去は、名前の重複の判定と同じ値で行うためユースケースが行う
export const CREATE_HELP_CATEGORY_ARGS = z.object({ name: z.string() });

export const RENAME_HELP_CATEGORY_ARGS = z.object({
  id: categoryId,
  name: z.string(),
});

export const DELETE_HELP_CATEGORY_ARGS = z.object({ id: categoryId });

export const REORDER_HELP_CATEGORIES_ARGS = z.object({ orderedIds });
