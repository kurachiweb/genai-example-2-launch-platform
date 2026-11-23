import { expect, type Locator, type Page, test } from '@playwright/test';

import {
  EMAIL_LABEL,
  NICKNAME_LABEL,
  PASSWORD_LABEL,
  REGISTER_SUBMIT_LABEL,
  REQUIRED_SUFFIX,
} from '../../../apps/client/src/components/auth/account-messages.ts';
import { SETTINGS_LINK } from '../../../apps/client/src/components/layout/site-links.ts';
import {
  BILLING_HISTORY_HREF,
  CHECKOUT_PAYMENT_TITLE,
} from '../../../apps/client/src/components/payments/checkout-messages.ts';
import {
  PAYMENT_HISTORY_PAGE_TITLE,
  SMOKE_CHECKOUT_LABEL,
} from '../../../apps/client/src/components/payments/payment-history-messages.ts';
import {
  HEADLINE_FIELD_LABEL,
  PROFILE_SAVE_LABEL,
  PROFILE_SAVED_MESSAGE,
} from '../../../apps/client/src/components/profile/profile-form-messages.ts';
import {
  SECURITY_SETTINGS_PAGE_TITLE,
  SETTINGS_NAVIGATION_LABEL,
} from '../../../apps/client/src/components/settings/settings-messages.ts';
import { ClientStartSmokeCheckoutDocument } from '../../../apps/client/src/graphql/generated/graphql.ts';
import { GRAPHQL_RELAY_PATH } from '../../../apps/frontend-lib/server/relay/relay-contract.ts';
import { documentIdOf } from '../../../apps/frontend-lib/utilities/graphql/persisted-document.ts';
import { waitForBotToken } from '../../support/bot-verification.ts';
import type { KeyboardOperator } from '../../support/keyboard-operator.ts';
import {
  PROFILE_SETTINGS_PATH,
  registerForm,
  SECURITY_SETTINGS_PATH,
  type TestAccount,
  userMenuButton,
} from '../auth/account-steps.ts';
import {
  consentCheckbox,
  SMOKE_CHECKOUT_SKIP_REASON,
} from '../checkout-steps.ts';
import { profileForm } from '../profile-steps.ts';

const START_SMOKE_CHECKOUT_DOCUMENT_ID = documentIdOf(
  ClientStartSmokeCheckoutDocument,
);

const PAYMENTS_UNAVAILABLE_CODE = 'payments_unavailable';

const CHECKOUT_PATH_PATTERN = /^\/checkout\/[0-9A-HJKMNP-TV-Z]{26}$/u;

const CHECKOUT_START_TIMEOUT_MS = 60_000;

const requiredLabel = (label: string): string => `${label}${REQUIRED_SUFFIX}`;

// 利用者の登録を、入力欄・規約への同意のチェックボックス・送信のボタンへTabで移り、入力とSpaceとEnterだけで行う
export async function registerByKeyboard(
  operator: KeyboardOperator,
  account: TestAccount,
): Promise<void> {
  const { page } = operator;
  await page.goto('/auth/register');
  const form = registerForm(page);
  await waitForBotToken(form);
  await operator.type(
    form.getByLabel(requiredLabel(NICKNAME_LABEL), { exact: true }),
    'ニックネーム',
    account.nickname,
  );
  await operator.type(
    form.getByLabel(requiredLabel(EMAIL_LABEL), { exact: true }),
    'メールアドレス',
    account.email,
  );
  await operator.type(
    form.getByLabel(requiredLabel(PASSWORD_LABEL), { exact: true }),
    'パスワード',
    account.password,
  );
  await operator.check(form.getByRole('checkbox'), '規約への同意');
  await operator.activate(
    form.getByRole('button', { name: REGISTER_SUBMIT_LABEL }),
    '登録の送信',
  );
  await expect(userMenuButton(page, account)).toBeVisible();
}

// ユーザーメニューをEscapeで閉じてフォーカスがメニューのボタンへ戻ることを確かめ、開き直して「設定」を選ぶ
export async function openSettingsByKeyboard(
  operator: KeyboardOperator,
  account: TestAccount,
): Promise<void> {
  const { page } = operator;
  const trigger = userMenuButton(page, account);
  const menu = page.getByRole('menu');
  await operator.activate(trigger, 'ユーザーメニュー');
  await expect(menu).toBeVisible();
  await operator.expectPopupEscapeCloses(menu, 'ユーザーメニュー', trigger);
  await operator.chooseMenuItem(
    trigger,
    SETTINGS_LINK.label,
    'ユーザーメニュー',
  );
  await expect(page).toHaveURL(PROFILE_SETTINGS_PATH);
}

// プロフィールの設定のヘッドラインを書き換えて保存し、設定のナビゲーションのリンクからセキュリティの設定へ移る
export async function editProfileByKeyboard(
  operator: KeyboardOperator,
  headline: string,
): Promise<void> {
  const { page } = operator;
  const form = profileForm(page);
  await expect(form).toBeVisible();
  await waitForBotToken(form);
  await operator.type(
    form.getByLabel(HEADLINE_FIELD_LABEL, { exact: true }),
    'ヘッドライン',
    headline,
  );
  await operator.activate(
    form.getByRole('button', { name: PROFILE_SAVE_LABEL, exact: true }),
    'プロフィールの保存',
  );
  await expect(page.getByText(PROFILE_SAVED_MESSAGE)).toBeVisible();
}

const settingsNavLink = (page: Page, label: string): Locator =>
  page
    .getByRole('navigation', { name: SETTINGS_NAVIGATION_LABEL })
    .getByRole('link', { name: label, exact: true });

export async function openSecuritySettingsByKeyboard(
  operator: KeyboardOperator,
): Promise<void> {
  const { page } = operator;
  await operator.activate(
    settingsNavLink(page, SECURITY_SETTINGS_PAGE_TITLE),
    '設定のナビゲーションのセキュリティ',
  );
  await expect(page).toHaveURL(SECURITY_SETTINGS_PATH);
  await expect(
    page.getByRole('heading', { level: 1, name: SECURITY_SETTINGS_PAGE_TITLE }),
  ).toBeVisible();
}

// 設定のナビゲーションから決済履歴を開き、疎通確認の購入の開始のボタンをEnterで押す。Stripeのキーが無い環境では、決済の開始が利用できない旨を示してテストを飛ばす
export async function startCheckoutByKeyboard(
  operator: KeyboardOperator,
): Promise<void> {
  const { page } = operator;
  await operator.activate(
    settingsNavLink(page, PAYMENT_HISTORY_PAGE_TITLE),
    '設定のナビゲーションの決済履歴',
  );
  await expect(page).toHaveURL(BILLING_HISTORY_HREF);
  const responsePromise = page.waitForResponse((response) => {
    if (new URL(response.url()).pathname !== GRAPHQL_RELAY_PATH) {
      return false;
    }
    try {
      const body: unknown = response.request().postDataJSON();
      return (
        typeof body === 'object' &&
        body !== null &&
        'documentId' in body &&
        body.documentId === START_SMOKE_CHECKOUT_DOCUMENT_ID
      );
    } catch {
      return false;
    }
  });
  await operator.activate(
    page
      .getByRole('main')
      .getByRole('button', { name: SMOKE_CHECKOUT_LABEL, exact: true }),
    '疎通確認の決済の開始',
  );
  const response = await responsePromise;
  test.skip(
    (await response.text()).includes(PAYMENTS_UNAVAILABLE_CODE),
    SMOKE_CHECKOUT_SKIP_REASON,
  );
  await expect(page).toHaveURL(
    (url) => CHECKOUT_PATH_PATTERN.test(url.pathname),
    {
      timeout: CHECKOUT_START_TIMEOUT_MS,
    },
  );
}

// 決済画面のお支払い情報の区画が表示された後、同意のチェックボックスへTabで移ってSpaceで選べることを確かめる
export async function consentByKeyboard(
  operator: KeyboardOperator,
): Promise<void> {
  const { page } = operator;
  await expect(
    page
      .getByRole('main')
      .getByRole('region', { name: CHECKOUT_PAYMENT_TITLE, exact: true }),
  ).toBeVisible();
  await operator.check(consentCheckbox(page), '決済の同意');
}
