import { describe, expect, test } from 'bun:test';

import { SPONSORSHIP_OFFER_REJECTION_MESSAGES } from './offer-rejection.ts';

describe('SPONSORSHIP_OFFER_REJECTION_MESSAGES', () => {
  test('文言規則のスポンサー広告の購入の可否の拒否の文言を持つ', () => {
    expect(SPONSORSHIP_OFFER_REJECTION_MESSAGES).toStrictEqual({
      sponsorship_not_payable:
        '掲載開始日を過ぎたため、この申込は決済できません。新しく申し込んでください。',
      sponsorship_period_invalid:
        'この申込の掲載期間では決済できません。新しく申し込んでください。',
      sponsorship_product_ineligible:
        'このプロダクトはスポンサー広告を申し込めません。',
      sponsorship_overlap:
        'このプロダクトは選んだ期間に同じティアの広告を掲載中または掲載予定です。期間を変えて申し込んでください。',
    });
  });

  test('凍結されている', () => {
    expect(Object.isFrozen(SPONSORSHIP_OFFER_REJECTION_MESSAGES)).toBe(true);
  });
});
