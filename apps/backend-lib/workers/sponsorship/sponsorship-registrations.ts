import { SPONSORSHIP_PLATFORM_TYPES } from '../../core/sponsorship/identifiers.ts';
import type { PurchaseKindRegistration } from '../payments/fulfillment-contract.ts';

// 受付の可否は購入の可否の口が申込の状態と掲載期間で判定するため、登録には有効の条件を持たせない
export const SPONSORSHIP_PURCHASE_KIND_REGISTRATION: PurchaseKindRegistration =
  Object.freeze({
    kind: 'sponsorship',
    offer: SPONSORSHIP_PLATFORM_TYPES.SponsorshipOfferPolicy,
    fulfillment: SPONSORSHIP_PLATFORM_TYPES.SponsorshipFulfillment,
  });
