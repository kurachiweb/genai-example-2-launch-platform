import { z } from 'zod';

import { PAYMENT_HISTORY_CURSOR_MAX } from '../../../../../common-lib/payments/payment-input-rules.ts';
import {
  CURSOR_TOO_LONG_MESSAGE,
  PURCHASE_ID_TOO_LONG_MESSAGE,
} from './errors.ts';

// 一致しない購入のIDはユースケースが見つからない旨にする。ここでは処理量だけを抑える
const PURCHASE_ID_INPUT_MAX_LENGTH = 64;

const purchaseId = z
  .string()
  .max(PURCHASE_ID_INPUT_MAX_LENGTH, PURCHASE_ID_TOO_LONG_MESSAGE);

export const PURCHASE_ARGS = z.object({ purchaseId });

// 決済セッションのIDの形式と長さはユースケースが共用部品の入力規則で確かめる
export const CONFIRM_CHECKOUT_RETURN_ARGS = z.object({
  sessionId: z.string(),
});

// 件数の範囲はユースケースが、カーソルの形式の誤りはユースケースが位置の指定のエラーにする。ここではカーソルの処理量だけを抑える
export const PAYMENT_HISTORY_ARGS = z.object({
  first: z
    .number()
    .nullish()
    .transform((value) => value ?? undefined),
  after: z
    .string()
    .max(PAYMENT_HISTORY_CURSOR_MAX, CURSOR_TOO_LONG_MESSAGE)
    .nullish()
    .transform((value) => value ?? undefined),
});
