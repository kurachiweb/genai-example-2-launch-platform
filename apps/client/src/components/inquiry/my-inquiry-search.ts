import { INQUIRY_CURSOR_MAX } from '../../../common-lib/inquiry/inquiry-input-rules.ts';
import { z } from '../../../lib/utilities/validation/zod.ts';

// 自分の問い合わせの一覧のページの位置のカーソル。無ければ1ページ目
export interface MyInquirySearch {
  readonly after?: string | undefined;
}

// 共有されたURLや手で書き換えたURLの不正な値は、APIの拒否で一覧を失敗させず、1ページ目として扱う
const SEARCH_SCHEMA = z.object({
  after: z.string().min(1).max(INQUIRY_CURSOR_MAX).optional().catch(undefined),
});

export const myInquirySearchAt = (
  after: string | undefined,
): MyInquirySearch => (after === undefined ? {} : { after });

// ルーターは検証の結果をURLの元の値に重ねるため、元の値を残さないよう常に項目を返す
export const toMyInquirySearch = (
  search: Record<string, unknown>,
): MyInquirySearch => ({ after: SEARCH_SCHEMA.parse(search).after });
