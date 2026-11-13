import {
  expect,
  type Frame,
  type Locator,
  type Page,
  type Response,
} from '@playwright/test';

import {
  BILLING_HISTORY_LINK_LABEL,
  CHECKOUT_ITEM_LABEL,
  CHECKOUT_PAYMENT_METHOD_LABEL,
  CHECKOUT_PAYMENT_METHODS,
  CHECKOUT_PAYMENT_TIMING_LABEL,
  CHECKOUT_PAYMENT_TITLE,
  CHECKOUT_PRICE_LABEL,
  CHECKOUT_QUANTITY_LABEL,
  CHECKOUT_RETURN_COMPLETED_MESSAGE,
  CHECKOUT_SERVICE_TIMING_LABEL,
  CHECKOUT_SUMMARY_TITLE,
  CONSENT_REQUIRED_SUFFIX,
  ONE_TIME_PAYMENT_TIMING,
  PAY_LABEL,
} from '../../apps/client/src/components/payments/checkout-messages.ts';
import {
  CHECKOUT_RETURN_RECHECK_INTERVAL_MS,
  CHECKOUT_RETURN_RECHECK_LIMIT,
} from '../../apps/client/src/components/payments/checkout-return-rules.ts';
import {
  PAYMENT_AMOUNT_LABEL,
  PAYMENT_RECORD_KIND_LABEL,
  PAYMENT_STATUS_LABEL,
  SMOKE_CHECKOUT_LABEL,
} from '../../apps/client/src/components/payments/payment-history-messages.ts';
import { ClientStartSmokeCheckoutDocument } from '../../apps/client/src/graphql/generated/graphql.ts';
import { CHECKOUT_CONSENT_TEXT } from '../../apps/common-lib/payments/checkout-consent.ts';
import {
  PAYMENT_RECORD_KIND_LABELS,
  PAYMENT_RECORD_STATUS_LABELS,
} from '../../apps/common-lib/payments/payment-record-values.ts';
import { PURCHASE_KIND_LABELS } from '../../apps/common-lib/payments/purchase-kinds.ts';
import { GRAPHQL_RELAY_PATH } from '../../apps/frontend-lib/server/relay/relay-contract.ts';
import { documentIdOf } from '../../apps/frontend-lib/utilities/graphql/persisted-document.ts';
import { REACTION_TIMEOUT_MS } from '../support/hydration-retry.ts';
import { paymentHistoryList, STRIPE_JS_ORIGIN } from './billing-steps.ts';

export const SMOKE_CHECKOUT_SKIP_REASON =
  'Stripeのsandboxのキーが無い環境のため、決済のE2Eを飛ばします';

// 登録・メールの確認・Stripeの入力欄の読み込み・Stripeによる移動・決済後のランディングの確かめ直し・購入確認メールの到着を1つの流れで待つ
export const CHECKOUT_FLOW_TIMEOUT_MS = 240_000;

// 疎通確認の購入の内容は購入種別を受け持つ部品(backend-libのsmoke-purchase.ts)が決める
const SMOKE_PURCHASE_ITEM_NAME = PURCHASE_KIND_LABELS.payments_smoke;
const SMOKE_PURCHASE_QUANTITY_LABEL = '1件';
const SMOKE_PURCHASE_SERVICE_TIMING = '提供する役務はありません';

// 1USDは表示の言語によらず小数点以下2桁の「1.00」を含む
const SMOKE_PURCHASE_AMOUNT_TEXT = '1.00';

const PAYMENTS_UNAVAILABLE_CODE = 'payments_unavailable';

const START_SMOKE_CHECKOUT_DOCUMENT_ID = documentIdOf(
  ClientStartSmokeCheckoutDocument,
);

const CHECKOUT_PATH_PATTERN =
  /^\/checkout\/(?<purchaseId>[0-9A-HJKMNP-TV-Z]{26})$/u;

const CHECKOUT_RETURN_PATH = '/checkout/return';

// Stripe.jsの読み込みと入力欄の枠の描画は外部への通信を含むため、既定の5秒より長く待つ
const STRIPE_ELEMENT_TIMEOUT_MS = 30_000;

// 支払いの確定からStripeが決済後のランディングへ移すまで
const STRIPE_REDIRECT_TIMEOUT_MS = 60_000;

// 決済後のランディングは処理中の間、一定の間隔で上限の回数まで確かめ直すため、その合計に初回の確認の余裕を足す
const RETURN_COMPLETION_TIMEOUT_MS =
  CHECKOUT_RETURN_RECHECK_INTERVAL_MS * CHECKOUT_RETURN_RECHECK_LIMIT + 15_000;

const TEST_CARD = Object.freeze({
  number: '4242424242424242',
  expiry: '1234',
  cvc: '123',
});

const TEST_BILLING_ADDRESS = Object.freeze({
  name: 'E2E Purchaser',
  country: 'US',
  line1: '510 Townsend St',
  city: 'San Francisco',
  state: 'CA',
  postalCode: '94103',
});

export type SmokeCheckoutStart =
  | { readonly kind: 'started'; readonly purchaseId: string }
  | { readonly kind: 'payments_unavailable' };

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null;

const requestDocumentIdOf = (response: Response): unknown => {
  try {
    const body: unknown = response.request().postDataJSON();
    return isRecord(body) ? body.documentId : undefined;
  } catch {
    return undefined;
  }
};

const isStartSmokeCheckoutResponse = (response: Response): boolean =>
  new URL(response.url()).pathname === GRAPHQL_RELAY_PATH &&
  requestDocumentIdOf(response) === START_SMOKE_CHECKOUT_DOCUMENT_ID;

// GraphQLの失敗は最初のエラーのextensions.codeに、中継とゲートウェイの拒否は共通のエラー形式のerror.codeに入る
function errorCodeOf(body: unknown): string | undefined {
  if (!isRecord(body)) {
    return undefined;
  }
  const { errors, error } = body;
  if (Array.isArray(errors)) {
    const first: unknown = errors.at(0);
    const extensions = isRecord(first) ? first.extensions : undefined;
    const code = isRecord(extensions) ? extensions.code : undefined;
    return typeof code === 'string' ? code : 'unknown';
  }
  if (isRecord(error)) {
    return typeof error.code === 'string' ? error.code : 'unknown';
  }
  return undefined;
}

// 決済履歴の開始のボタンを押し、APIサーバーの応答から、決済画面へ移ったかStripeのキーが無いために利用できないかを返す
export async function startSmokeCheckout(
  page: Page,
): Promise<SmokeCheckoutStart> {
  const responsePromise = page.waitForResponse(isStartSmokeCheckoutResponse);
  await page
    .getByRole('main')
    .getByRole('button', { name: SMOKE_CHECKOUT_LABEL, exact: true })
    .click();
  const response = await responsePromise;
  const code = errorCodeOf(await response.json());
  if (code === PAYMENTS_UNAVAILABLE_CODE) {
    return { kind: 'payments_unavailable' };
  }
  if (code !== undefined) {
    throw new Error(
      `疎通確認の決済を始められませんでした: 状態コード${String(response.status())} ${code}`,
    );
  }
  await expect(page).toHaveURL((url) =>
    CHECKOUT_PATH_PATTERN.test(url.pathname),
  );
  const purchaseId = CHECKOUT_PATH_PATTERN.exec(new URL(page.url()).pathname)
    ?.groups?.purchaseId;
  if (purchaseId === undefined) {
    throw new Error(`決済画面のURLから購入IDを読めません: ${page.url()}`);
  }
  return { kind: 'started', purchaseId };
}

const checkoutSummary = (page: Page): Locator =>
  page
    .getByRole('main')
    .getByRole('region', { name: CHECKOUT_SUMMARY_TITLE, exact: true });

const paymentSection = (page: Page): Locator =>
  page
    .getByRole('main')
    .getByRole('region', { name: CHECKOUT_PAYMENT_TITLE, exact: true });

const escapeRegExp = (text: string): string =>
  text.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);

// 定義リストの項目名に一致するdtの直後のddを返す
const definitionOf = (container: Locator, term: string): Locator =>
  container
    .locator('dt')
    .filter({ hasText: new RegExp(`^${escapeRegExp(term)}$`, 'u') })
    .locator('xpath=following-sibling::dd[1]');

export const payButton = (page: Page): Locator =>
  paymentSection(page).getByRole('button', { name: PAY_LABEL, exact: true });

export const consentCheckbox = (page: Page): Locator =>
  paymentSection(page).getByRole('checkbox', {
    name: `${CHECKOUT_CONSENT_TEXT}${CONSENT_REQUIRED_SUFFIX}`,
    exact: true,
  });

// 特定商取引法の最終確認画面の表示事項が、決済情報の入力欄より上に出ていることを確かめる
export async function expectSmokeCheckoutSummary(page: Page): Promise<void> {
  const summary = checkoutSummary(page);
  const expected: readonly (readonly [string, string])[] = [
    [CHECKOUT_ITEM_LABEL, SMOKE_PURCHASE_ITEM_NAME],
    [CHECKOUT_QUANTITY_LABEL, SMOKE_PURCHASE_QUANTITY_LABEL],
    [CHECKOUT_PRICE_LABEL, SMOKE_PURCHASE_AMOUNT_TEXT],
    [CHECKOUT_PAYMENT_METHOD_LABEL, CHECKOUT_PAYMENT_METHODS],
    [CHECKOUT_PAYMENT_TIMING_LABEL, ONE_TIME_PAYMENT_TIMING],
    [CHECKOUT_SERVICE_TIMING_LABEL, SMOKE_PURCHASE_SERVICE_TIMING],
  ];
  for (const [term, value] of expected) {
    await expect(definitionOf(summary, term)).toContainText(value);
  }
  const summaryBox = await summary.boundingBox();
  const paymentBox = await paymentSection(page).boundingBox();
  expect(summaryBox, '購入の内容の位置').not.toBeNull();
  expect(paymentBox, 'お支払い情報の位置').not.toBeNull();
  expect(
    (summaryBox?.y ?? 0) + (summaryBox?.height ?? 0),
    '購入の内容の下端がお支払い情報より上',
  ).toBeLessThanOrEqual(paymentBox?.y ?? 0);
}

// 入力欄はStripeの枠(iframe)ごとに分かれ、枠の名前や題名は表示の言語で変わるため、目的の入力欄を持つStripeの枠を探す
async function stripeFrameWith(page: Page, selector: string): Promise<Frame> {
  let found: Frame | undefined;
  await expect(async () => {
    found = undefined;
    for (const frame of page.frames()) {
      if (
        frame.url().startsWith(`${STRIPE_JS_ORIGIN}/`) &&
        (await frame.locator(selector).count()) > 0
      ) {
        found = frame;
        return;
      }
    }
    throw new Error(`${selector}を持つStripeの入力欄の枠がありません`);
  }).toPass({ timeout: STRIPE_ELEMENT_TIMEOUT_MS });
  if (found === undefined) {
    throw new Error(`${selector}を持つStripeの入力欄の枠がありません`);
  }
  return found;
}

// 請求先住所の入力欄が国と住所を集めるため、カードの入力欄に郵便番号が出た時だけ埋める
async function fillTestCard(page: Page): Promise<void> {
  const card = await stripeFrameWith(page, 'input[name="number"]');
  await card.locator('input[name="number"]').fill(TEST_CARD.number);
  await card.locator('input[name="expiry"]').fill(TEST_CARD.expiry);
  await card.locator('input[name="cvc"]').fill(TEST_CARD.cvc);
  const postalCode = card.locator('input[name="postalCode"]');
  if (await postalCode.isVisible()) {
    await postalCode.fill(TEST_BILLING_ADDRESS.postalCode);
  }
}

// 国を変えると住所の項目が組み替わるため、国を先に選ぶ
async function fillTestBillingAddress(page: Page): Promise<void> {
  const address = await stripeFrameWith(page, 'input[name="addressLine1"]');
  await address
    .locator('select[name="country"]')
    .selectOption(TEST_BILLING_ADDRESS.country);
  await address.locator('input[name="name"]').fill(TEST_BILLING_ADDRESS.name);
  const line1 = address.locator('input[name="addressLine1"]');
  await line1.fill(TEST_BILLING_ADDRESS.line1);
  // 住所の補完の候補が後の入力欄を覆わないよう閉じる
  await line1.press('Escape');
  await address
    .locator('input[name="locality"]')
    .fill(TEST_BILLING_ADDRESS.city);
  await address
    .locator('select[name="administrativeArea"]')
    .selectOption(TEST_BILLING_ADDRESS.state);
  await address
    .locator('input[name="postalCode"]')
    .fill(TEST_BILLING_ADDRESS.postalCode);
}

// 入力の直後はStripeの枠が大きさを変え続けてページのスクロールの位置が動くため、押す直前に同意の欄が動いて押し損ねることがある。同意の状態が変わるまで押し直す
async function checkConsent(page: Page): Promise<void> {
  await expect(async () => {
    await consentCheckbox(page).check({ timeout: REACTION_TIMEOUT_MS });
  }).toPass({ timeout: STRIPE_ELEMENT_TIMEOUT_MS });
}

// 同意の無い間は支払いを確定できないことを確かめてから、テストカードと請求先住所を入力して同意する
export async function preparePaymentWithTestCard(page: Page): Promise<void> {
  await expect(payButton(page)).toBeVisible({
    timeout: STRIPE_ELEMENT_TIMEOUT_MS,
  });
  await expect(consentCheckbox(page)).not.toBeChecked();
  await expect(payButton(page)).toBeDisabled();

  await fillTestCard(page);
  await fillTestBillingAddress(page);
  await expect(payButton(page)).toBeDisabled();

  await checkConsent(page);
  await expect(payButton(page)).toBeEnabled({
    timeout: STRIPE_ELEMENT_TIMEOUT_MS,
  });
}

// 支払いを確定すると、Stripeが決済後のランディングへ移す
export async function confirmPayment(page: Page): Promise<void> {
  await payButton(page).click();
  await expect(page).toHaveURL((url) => url.pathname === CHECKOUT_RETURN_PATH, {
    timeout: STRIPE_REDIRECT_TIMEOUT_MS,
  });
}

export async function expectCompletedReturn(page: Page): Promise<void> {
  const main = page.getByRole('main');
  await expect(main.getByRole('status')).toContainText(
    CHECKOUT_RETURN_COMPLETED_MESSAGE,
    { timeout: RETURN_COMPLETION_TIMEOUT_MS },
  );
  await expect(
    definitionOf(checkoutSummary(page), CHECKOUT_ITEM_LABEL),
  ).toContainText(SMOKE_PURCHASE_ITEM_NAME);
}

export async function openBillingFromReturn(page: Page): Promise<void> {
  await page
    .getByRole('main')
    .getByRole('link', { name: BILLING_HISTORY_LINK_LABEL, exact: true })
    .click();
}

export async function expectSmokePaymentRecord(page: Page): Promise<void> {
  const record = paymentHistoryList(page)
    .getByRole('listitem')
    .filter({ hasText: SMOKE_PURCHASE_ITEM_NAME });
  await expect(record).toHaveCount(1);
  await expect(definitionOf(record, PAYMENT_RECORD_KIND_LABEL)).toHaveText(
    PAYMENT_RECORD_KIND_LABELS.one_time,
  );
  await expect(definitionOf(record, PAYMENT_AMOUNT_LABEL)).toContainText(
    SMOKE_PURCHASE_AMOUNT_TEXT,
  );
  await expect(definitionOf(record, PAYMENT_STATUS_LABEL)).toHaveText(
    PAYMENT_RECORD_STATUS_LABELS.succeeded,
  );
}
