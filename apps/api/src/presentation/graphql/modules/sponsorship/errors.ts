import { SPONSORSHIP_OFFER_REJECTION_MESSAGES } from '../../../../../lib/core/sponsorship/offer-rejection.ts';
import { SPONSORSHIP_ERRORS } from '../../../../application/sponsorship/sponsorship-errors.ts';

// 申込の受付・決済の再開の拒否のコードと文言はユースケースと購入の可否の口にあり、それらが投げる

// 画面の操作では形式の違うIDを送らないため、存在しない対象と同じ文言を示す
export const PRODUCT_ID_INVALID_MESSAGE =
  SPONSORSHIP_OFFER_REJECTION_MESSAGES.sponsorship_product_ineligible;

export const SPONSORSHIP_ID_INVALID_MESSAGE =
  SPONSORSHIP_ERRORS.sponsorship_not_found.message;
