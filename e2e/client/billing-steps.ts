import { expect, type Locator, type Page } from '@playwright/test';

import { BILLING_HISTORY_HREF } from '../../apps/client/src/components/payments/checkout-messages.ts';
import {
  PAYMENT_HISTORY_EMPTY_MESSAGE,
  PAYMENT_HISTORY_PAGE_TITLE,
} from '../../apps/client/src/components/payments/payment-history-messages.ts';
import { SETTINGS_NAVIGATION_LABEL } from '../../apps/client/src/components/settings/settings-messages.ts';
import { openAccountSettings, type TestAccount } from './auth/account-steps.ts';

// 要件が設定のナビゲーションの項目の名前と画面の題名を同じ「決済履歴」と定めるため、項目は題名の文言で探す
const BILLING_NAV_LABEL = PAYMENT_HISTORY_PAGE_TITLE;

export const STRIPE_JS_ORIGIN = 'https://js.stripe.com';

export const billingHeading = (page: Page): Locator =>
  page.getByRole('heading', {
    level: 1,
    name: PAYMENT_HISTORY_PAGE_TITLE,
    exact: true,
  });

export const paymentHistoryList = (page: Page): Locator =>
  page
    .getByRole('main')
    .getByRole('list', { name: PAYMENT_HISTORY_PAGE_TITLE, exact: true });

export const paymentHistoryEmptyMessage = (page: Page): Locator =>
  page
    .getByRole('main')
    .getByText(PAYMENT_HISTORY_EMPTY_MESSAGE, { exact: true });

// Stripe.jsは読み込みの関数を呼んだ時に文書へscript要素として差し込まれる
export const stripeScripts = (page: Page): Locator =>
  page.locator(`script[src^="${STRIPE_JS_ORIGIN}/"]`);

// 決済履歴の開始のボタンはbot判定のウィジェットを持たずハイドレーションの完了を待つ手掛かりが無いため、ハイドレーション済みの設定ページからナビゲーションのリンクで開く
export async function openBillingFromSettingsNavigation(
  page: Page,
  account: TestAccount,
): Promise<void> {
  await openAccountSettings(page, account);
  const link = page
    .getByRole('navigation', { name: SETTINGS_NAVIGATION_LABEL })
    .getByRole('link', { name: BILLING_NAV_LABEL, exact: true });
  await link.click();
  await expect(page).toHaveURL(BILLING_HISTORY_HREF);
  await expect(billingHeading(page)).toBeVisible();
  await expect(link).toHaveAttribute('aria-current', 'page');
}
