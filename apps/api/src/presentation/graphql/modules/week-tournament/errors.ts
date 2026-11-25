import { WEEK_ENTRY_OFFER_REJECTION_MESSAGES } from '../../../../../lib/workers/week-tournament/week-entry-offer-policy.ts';

// 決済の開始の拒否のコードと文言は購入の可否の口(week-entry-offer-policy.ts)とpaymentsにあり、決済の開始が投げる

// 画面の操作では形式の違うローンチのIDを送らないため、文言規則どおり存在しない枠と同じ文言を示す
export const LAUNCH_ID_INVALID_MESSAGE =
  WEEK_ENTRY_OFFER_REJECTION_MESSAGES.week_entry_not_found;
