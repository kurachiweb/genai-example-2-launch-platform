import { checkCheckoutSessionId } from '../../../common-lib/payments/payment-input-rules.ts';
import { z } from '../../../lib/utilities/validation/zod.ts';

// 決済セッションの完了の通知はWebhookで遅れて届くため、処理中の間はこの間隔で確かめ直す
export const CHECKOUT_RETURN_RECHECK_INTERVAL_MS = 3000;

// 確かめ直しの回数の上限。超えた後は決済履歴での確認を案内する
export const CHECKOUT_RETURN_RECHECK_LIMIT = 20;

// 検索パラメータの名前は、決済サービスがreturn_urlに埋める名前に合わせる
export interface CheckoutReturnSearch {
  readonly session_id?: string | undefined;
}

const SEARCH_SCHEMA = z.object({
  session_id: z
    .string()
    .refine((value) => checkCheckoutSessionId(value) === undefined)
    .optional()
    .catch(undefined),
});

// 形式に合わない値は確認を呼ばずに正しくない旨を示すため、欠落と同じに扱う。ルーターは検証の結果をURLの元の値に重ねるため、元の値を残さないよう常に項目を返す
export const toCheckoutReturnSearch = (
  search: Record<string, unknown>,
): CheckoutReturnSearch => ({
  session_id: SEARCH_SCHEMA.parse(search).session_id,
});
