// 文言を変えるときは版を改める。購入と決済履歴の記録が同意した版を残すため
export const CHECKOUT_CONSENT_VERSION = '2026-10-23';

export const CHECKOUT_CONSENT_TEXT =
  '購入の確定後すぐに役務の提供が始まることに同意し、提供の開始により、EU・英国の消費者に認められる14日間の撤回権を失うことを了承します。';

// 購入確認メールが同意した版の文言を載せるため、版を改めても以前の版の文言を残す
const CHECKOUT_CONSENT_TEXTS: ReadonlyMap<string, string> = new Map([
  [CHECKOUT_CONSENT_VERSION, CHECKOUT_CONSENT_TEXT],
]);

export function checkoutConsentTextOf(version: string): string | undefined {
  return CHECKOUT_CONSENT_TEXTS.get(version);
}
