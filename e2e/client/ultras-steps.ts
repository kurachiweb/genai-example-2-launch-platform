import {
  expect,
  type Locator,
  type Page,
  type Response,
} from '@playwright/test';

import {
  CHECKOUT_ITEM_LABEL,
  CHECKOUT_RETURN_COMPLETED_MESSAGE,
  CHECKOUT_SUMMARY_TITLE,
  PURCHASED_DESTINATIONS,
} from '../../apps/client/src/components/payments/checkout-messages.ts';
import {
  CHECKOUT_RETURN_RECHECK_INTERVAL_MS,
  CHECKOUT_RETURN_RECHECK_LIMIT,
} from '../../apps/client/src/components/payments/checkout-return-rules.ts';
import { SETTINGS_NAVIGATION_LABEL } from '../../apps/client/src/components/settings/settings-messages.ts';
import {
  PLAN_PAGE_TITLE,
  PLAN_STATUS_SECTION_TITLE,
  PORTAL_BUTTON_LABEL,
} from '../../apps/client/src/components/ultras/plan-messages.ts';
import {
  PRICING_LEGAL_NOTICE_LINK_LABEL,
  PRICING_PAGE_TITLE,
} from '../../apps/client/src/components/ultras/pricing-messages.ts';
import {
  PLAN_PAGE_HREF,
  ULTRAS_BENEFITS_TITLE,
  ULTRAS_MONTHLY_PRICE_PREFIX,
  ULTRAS_MONTHLY_PRICE_SUFFIX,
  ULTRAS_PLAN_STATUS_LABEL,
  ULTRAS_PRICE_UNAVAILABLE_MESSAGE,
  ULTRAS_PRICING_SECTION_TITLE,
  ULTRAS_SUBSCRIBE_LABEL,
} from '../../apps/client/src/components/ultras/ultras-messages.ts';
import { ClientStartUltrasCheckoutDocument } from '../../apps/client/src/graphql/generated/graphql.ts';
import { PURCHASE_KIND_LABELS } from '../../apps/common-lib/payments/purchase-kinds.ts';
import {
  ULTRAS_PLAN_STATUS_LABELS,
  type UltrasPlanStatus,
} from '../../apps/common-lib/ultras/plan-status.ts';
import { ULTRAS_PROMOTION_FLAG_KEY } from '../../apps/common-lib/ultras/promotion-flag.ts';
import { GRAPHQL_RELAY_PATH } from '../../apps/frontend-lib/server/relay/relay-contract.ts';
import { documentIdOf } from '../../apps/frontend-lib/utilities/graphql/persisted-document.ts';
import {
  REACTION_TIMEOUT_MS,
  RETRY_TIMEOUT_MS,
} from '../support/hydration-retry.ts';
import { executeLocalD1, sqlStringLiteral } from '../support/local-d1.ts';
import {
  openAccountSettings,
  type TestAccount,
  userMenuButton,
} from './auth/account-steps.ts';
import { CHECKOUT_FLOW_TIMEOUT_MS } from './checkout-steps.ts';

export const ULTRAS_CHECKOUT_SKIP_REASON =
  'Stripeのsandboxのキーが無い環境のため、Ultrasの加入のE2Eを飛ばします';

export const ULTRAS_PRICE_UNAVAILABLE_SKIP_REASON =
  'Ultrasの月額の価格を照会できない環境(Stripeのsandboxのキーか月額の価格が無い)のため、Ultrasの加入のE2Eを飛ばします';

// Customer Portalのセッションの作成からStripeのPortalの画面へ移るまで
const PORTAL_REDIRECT_TIMEOUT_MS = 60_000;

// 疎通確認の決済と同じ流れ(登録・メールの確認・決済・決済後のランディング)に、Customer Portalへの移動を足す
export const ULTRAS_FLOW_TIMEOUT_MS =
  CHECKOUT_FLOW_TIMEOUT_MS + PORTAL_REDIRECT_TIMEOUT_MS;

const STRIPE_PORTAL_HOST = 'billing.stripe.com';

const PAYMENTS_UNAVAILABLE_CODE = 'payments_unavailable';

const START_ULTRAS_CHECKOUT_DOCUMENT_ID = documentIdOf(
  ClientStartUltrasCheckoutDocument,
);

const CHECKOUT_PATH_PATTERN =
  /^\/checkout\/(?<purchaseId>[0-9A-HJKMNP-TV-Z]{26})$/u;

// 決済後のランディングは処理中の間、一定の間隔で上限の回数まで確かめ直すため、その合計に初回の確認の余裕を足す
const RETURN_COMPLETION_TIMEOUT_MS =
  CHECKOUT_RETURN_RECHECK_INTERVAL_MS * CHECKOUT_RETURN_RECHECK_LIMIT + 15_000;

// 要件が設定のナビゲーションの項目の名前と画面の題名を同じ「プラン」と定めるため、項目は題名の文言で探す
const PLAN_NAV_LABEL = PLAN_PAGE_TITLE;

const PROMOTION_FLAG_KEY_LITERAL = sqlStringLiteral(ULTRAS_PROMOTION_FLAG_KEY);

const missingFlagRowError = (): Error =>
  new Error(
    `ローカルのD1にUltras導線の機能フラグの行(setting_key = ${ULTRAS_PROMOTION_FLAG_KEY})がありません。apps/apiでbun run db:migrate:localを実行してください`,
  );

// 機能フラグの行は初期データのマイグレーションが入れるため、更新した行が無ければマイグレーションの未適用として失敗する
export async function setUltrasPromotionFlag(enabled: boolean): Promise<void> {
  const updated = await executeLocalD1(
    `UPDATE ultras_settings SET enabled = ${enabled ? '1' : '0'}, version = version + 1, updated_at = ${String(Date.now())} WHERE setting_key = ${PROMOTION_FLAG_KEY_LITERAL} RETURNING id;`,
  );
  if (updated.length !== 1) {
    throw missingFlagRowError();
  }
}

export async function readUltrasPromotionFlag(): Promise<boolean> {
  const [row] = await executeLocalD1(
    `SELECT enabled FROM ultras_settings WHERE setting_key = ${PROMOTION_FLAG_KEY_LITERAL};`,
  );
  if (row === undefined) {
    throw missingFlagRowError();
  }
  return Number(row.enabled) === 1;
}

const escapeRegExp = (text: string): string =>
  text.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);

// 定義リストの項目名に一致するdtの直後のddを返す
const definitionOf = (container: Locator, term: string): Locator =>
  container
    .locator('dt')
    .filter({ hasText: new RegExp(`^${escapeRegExp(term)}$`, 'u') })
    .locator('xpath=following-sibling::dd[1]');

export const pricingHeading = (page: Page): Locator =>
  page.getByRole('heading', {
    level: 1,
    name: PRICING_PAGE_TITLE,
    exact: true,
  });

export const ultrasPricingSection = (page: Page): Locator =>
  page
    .getByRole('main')
    .getByRole('region', { name: ULTRAS_PRICING_SECTION_TITLE, exact: true });

// 共通フッターにも同じ文言のリンクがあるため、本文の中のリンクに絞る
export const legalNoticeLink = (page: Page): Locator =>
  page
    .getByRole('main')
    .getByRole('link', { name: PRICING_LEGAL_NOTICE_LINK_LABEL, exact: true });

export const benefitItems = (section: Locator): Locator =>
  section
    .getByRole('list', { name: ULTRAS_BENEFITS_TITLE, exact: true })
    .getByRole('listitem');

export const ultrasSubscribeButton = (page: Page): Locator =>
  page
    .getByRole('main')
    .getByRole('button', { name: ULTRAS_SUBSCRIBE_LABEL, exact: true });

const priceUnavailableMessage = (scope: Locator): Locator =>
  scope.getByText(ULTRAS_PRICE_UNAVAILABLE_MESSAGE, { exact: true });

// 価格は、開発者がsandboxに月額の価格を用意していれば「月額<金額>(税込)」、照会できなければ表示できない旨になる
export async function expectUltrasPriceLine(section: Locator): Promise<void> {
  const price = section.getByText(
    new RegExp(
      `^${escapeRegExp(ULTRAS_MONTHLY_PRICE_PREFIX)}.+${escapeRegExp(ULTRAS_MONTHLY_PRICE_SUFFIX)}$`,
      'u',
    ),
  );
  await expect(priceUnavailableMessage(section).or(price)).toBeVisible();
}

export const planHeading = (page: Page): Locator =>
  page.getByRole('heading', { level: 1, name: PLAN_PAGE_TITLE, exact: true });

export const planStatusSection = (page: Page): Locator =>
  page
    .getByRole('main')
    .getByRole('region', { name: PLAN_STATUS_SECTION_TITLE, exact: true });

// プラン管理画面の加入のボタンはbot判定のウィジェットを持たずハイドレーションの完了を待つ手掛かりが無いため、ハイドレーション済みの設定ページからナビゲーションのリンクで開く
export async function openPlanFromSettingsNavigation(
  page: Page,
  account: TestAccount,
): Promise<void> {
  await openAccountSettings(page, account);
  const link = page
    .getByRole('navigation', { name: SETTINGS_NAVIGATION_LABEL })
    .getByRole('link', { name: PLAN_NAV_LABEL, exact: true });
  await link.click();
  await expect(page).toHaveURL(PLAN_PAGE_HREF);
  await expect(planHeading(page)).toBeVisible();
  await expect(link).toHaveAttribute('aria-current', 'page');
}

export async function expectPlanStatus(
  page: Page,
  status: UltrasPlanStatus,
): Promise<void> {
  await expect(
    planStatusSection(page).getByText(
      `${ULTRAS_PLAN_STATUS_LABEL}: ${ULTRAS_PLAN_STATUS_LABELS[status]}`,
      { exact: true },
    ),
  ).toBeVisible();
}

export type UltrasCheckoutStart =
  | { readonly kind: 'started'; readonly purchaseId: string }
  | { readonly kind: 'payments_unavailable' }
  | { readonly kind: 'price_unavailable' };

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

const isStartUltrasCheckoutResponse = (response: Response): boolean =>
  new URL(response.url()).pathname === GRAPHQL_RELAY_PATH &&
  requestDocumentIdOf(response) === START_ULTRAS_CHECKOUT_DOCUMENT_ID;

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

// 「Ultrasに加入」を押し、APIサーバーの応答から、決済画面へ移ったかStripeのキーが無いために利用できないかを返す。価格を照会できない環境ではボタンが価格なしの理由で無効のまま押せず応答を得られないため、その状態も区別して返す
export async function startUltrasCheckout(
  page: Page,
): Promise<UltrasCheckoutStart> {
  const button = ultrasSubscribeButton(page);
  await expect(button).toBeVisible();
  if (await button.isDisabled()) {
    await expect(
      priceUnavailableMessage(page.getByRole('main')),
      '加入のボタンが無効な理由',
    ).toBeVisible();
    return { kind: 'price_unavailable' };
  }
  const responsePromise = page.waitForResponse(isStartUltrasCheckoutResponse);
  await button.click();
  const response = await responsePromise;
  const code = errorCodeOf(await response.json());
  if (code === PAYMENTS_UNAVAILABLE_CODE) {
    return { kind: 'payments_unavailable' };
  }
  if (code !== undefined) {
    throw new Error(
      `Ultrasの加入を始められませんでした: 状態コード${String(response.status())} ${code}`,
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

export async function expectUltrasCheckoutItem(page: Page): Promise<void> {
  await expect(
    definitionOf(checkoutSummary(page), CHECKOUT_ITEM_LABEL),
  ).toContainText(PURCHASE_KIND_LABELS.ultras);
}

export async function expectUltrasCompletedReturn(page: Page): Promise<void> {
  await expect(page.getByRole('main').getByRole('status')).toContainText(
    CHECKOUT_RETURN_COMPLETED_MESSAGE,
    { timeout: RETURN_COMPLETION_TIMEOUT_MS },
  );
  await expectUltrasCheckoutItem(page);
}

export async function openPlanFromReturn(page: Page): Promise<void> {
  const destination = PURCHASED_DESTINATIONS.ULTRAS;
  if (destination === undefined) {
    throw new Error(
      '決済後のランディングにUltrasの購入の対象の画面への導線がありません',
    );
  }
  await page
    .getByRole('main')
    .getByRole('link', { name: destination.label, exact: true })
    .click();
  await expect(page).toHaveURL(destination.href);
  await expect(planHeading(page)).toBeVisible();
}

export const portalButton = (page: Page): Locator =>
  page
    .getByRole('main')
    .getByRole('button', { name: PORTAL_BUTTON_LABEL, exact: true });

// Portalのボタンはbot判定のウィジェットを持たずハイドレーションの完了を待つ手掛かりが無いため、開閉にハイドレーションを要する利用者のメニューを一度開いて閉じてから押す
async function waitForHydration(
  page: Page,
  account: TestAccount,
): Promise<void> {
  const menu = page.getByRole('menu');
  await expect(async () => {
    if (!(await menu.isVisible())) {
      await userMenuButton(page, account).click();
    }
    await expect(menu).toBeVisible({ timeout: REACTION_TIMEOUT_MS });
  }).toPass({ timeout: RETRY_TIMEOUT_MS });
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
}

// 「解約・支払い方法の管理」を押すと、APIサーバーが作ったセッションのURLでStripeのCustomer Portalへ移る
export async function openCustomerPortal(
  page: Page,
  account: TestAccount,
): Promise<void> {
  await waitForHydration(page, account);
  await portalButton(page).click();
  await expect(page).toHaveURL((url) => url.hostname === STRIPE_PORTAL_HOST, {
    timeout: PORTAL_REDIRECT_TIMEOUT_MS,
  });
}
