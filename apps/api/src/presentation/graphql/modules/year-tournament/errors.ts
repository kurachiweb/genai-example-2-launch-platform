import { YEAR_ENTRY_OFFER_REJECTION_MESSAGES } from '../../../../../lib/workers/year-tournament/year-entry-offer-policy.ts';

// 決済の開始の拒否のコードと文言は購入の可否の口(year-entry-offer-policy.ts)とpaymentsにあり、決済の開始が投げる

// 画面の操作では形式の違うローンチのIDを送らないため、文言規則どおり存在しない枠と同じ文言を示す
export const LAUNCH_ID_INVALID_MESSAGE =
  YEAR_ENTRY_OFFER_REJECTION_MESSAGES.year_entry_not_found;
