import { z } from 'zod';

import {
  PRODUCT_HANDLE_MESSAGES,
  PRODUCT_HANDLE_RULE,
} from '../../../../../common-lib/product/product-input-rules.ts';
import { invalidCursorError } from '../../../../../lib/core/errors/invalid-cursor.ts';
import { PRODUCT_STATE_BATCH_MAX } from '../../../../application/product/product-state-evaluator.ts';

// admin・inquiry・payments・フォローの一覧のカーソルと同じ上限。位置のカーソルはこれより十分に短い
export const PRODUCT_LIST_CURSOR_MAX = 256;

// 基盤のCURSOR_PAGE_ARGSは1〜100件のため、1ページの状態の判定の上限に合わせた件数の規則を各一覧で組み立てる。
// GraphQLの省略可能な引数は明示したnullでも届くため、未指定と同じ扱いにそろえる。空文字列は未指定ではなく不正なカーソルとして扱う
export function productPageArgsOf(maxPageSize: number) {
  const outOfRangeMessage = `表示する件数は1〜${String(maxPageSize)}件の整数で指定してください。`;
  return z.object({
    first: z
      .int(outOfRangeMessage)
      .min(1, outOfRangeMessage)
      .max(maxPageSize, outOfRangeMessage),
    after: z
      .string()
      .max(PRODUCT_LIST_CURSOR_MAX, invalidCursorError().message)
      .nullish()
      .transform((value) => value ?? undefined),
  });
}

export const MY_PRODUCTS_ARGS = productPageArgsOf(PRODUCT_STATE_BATCH_MAX);

const handleTooLongMessage = PRODUCT_HANDLE_MESSAGES['too-long'];

// 51文字以上は形式の確認に値しないため、検証の失敗として拒否する。空や文字種の違反は判定の結果INVALIDで返す。
// 編集中のハンドルは本人のプロダクトの照会にだけ使い、一致しなければ登録と同じ判定になる
export const PRODUCT_HANDLE_AVAILABILITY_ARGS = z.object({
  handle: z.string().max(PRODUCT_HANDLE_RULE.maxLength, handleTooLongMessage),
  productHandle: z
    .string()
    .max(PRODUCT_HANDLE_RULE.maxLength, handleTooLongMessage)
    .nullish()
    .transform((value) => value ?? undefined),
});
