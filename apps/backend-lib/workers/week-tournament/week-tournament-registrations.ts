import { WEEK_TOURNAMENT_TYPES } from '../../core/week-tournament/identifiers.ts';
import type { PurchaseKindRegistration } from '../payments/fulfillment-contract.ts';

// 受付の可否は購入の可否の口が枠の状態と期限で判定するため、登録には有効の条件を持たせない
export const WEEK_TOURNAMENT_PURCHASE_KIND_REGISTRATION: PurchaseKindRegistration =
  Object.freeze({
    kind: 'week_tournament_entry',
    offer: WEEK_TOURNAMENT_TYPES.WeekEntryOfferPolicy,
    fulfillment: WEEK_TOURNAMENT_TYPES.WeekEntryFulfillment,
  });
