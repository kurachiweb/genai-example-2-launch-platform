export type SponsorshipOfferRejectionCode =
  | 'sponsorship_not_payable'
  | 'sponsorship_period_invalid'
  | 'sponsorship_product_ineligible'
  | 'sponsorship_overlap';

// 購入の可否の拒否の文言の唯一の出どころ。申込の受付のユースケースとGraphQLのエラーもここから読む
export const SPONSORSHIP_OFFER_REJECTION_MESSAGES: Readonly<
  Record<SponsorshipOfferRejectionCode, string>
> = Object.freeze({
  sponsorship_not_payable:
    '掲載開始日を過ぎたため、この申込は決済できません。新しく申し込んでください。',
  sponsorship_period_invalid:
    'この申込の掲載期間では決済できません。新しく申し込んでください。',
  sponsorship_product_ineligible:
    'このプロダクトはスポンサー広告を申し込めません。',
  sponsorship_overlap:
    'このプロダクトは選んだ期間に同じティアの広告を掲載中または掲載予定です。期間を変えて申し込んでください。',
});
