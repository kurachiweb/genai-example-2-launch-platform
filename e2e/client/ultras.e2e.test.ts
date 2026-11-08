import { PLAN_NOT_SUBSCRIBED_MESSAGE } from '../../apps/client/src/components/ultras/plan-messages.ts';
import { LEGAL_NOTICE_HREF } from '../../apps/client/src/components/ultras/pricing-messages.ts';
import {
  PRICING_PAGE_HREF,
  ULTRAS_BENEFITS,
} from '../../apps/client/src/components/ultras/ultras-messages.ts';
import {
  createTestAccount,
  registerAccount,
  verifyEmailFromMail,
} from './auth/account-steps.ts';
import { expect, test } from './auth/auth-test.ts';
import {
  confirmPayment,
  preparePaymentWithTestCard,
} from './checkout-steps.ts';
import {
  benefitItems,
  expectPlanStatus,
  expectUltrasCheckoutItem,
  expectUltrasCompletedReturn,
  expectUltrasPriceLine,
  legalNoticeLink,
  openCustomerPortal,
  openPlanFromReturn,
  openPlanFromSettingsNavigation,
  planStatusSection,
  pricingHeading,
  setUltrasPromotionFlag,
  startUltrasCheckout,
  ULTRAS_CHECKOUT_SKIP_REASON,
  ULTRAS_FLOW_TIMEOUT_MS,
  ULTRAS_PRICE_UNAVAILABLE_SKIP_REASON,
  ultrasPricingSection,
  ultrasSubscribeButton,
} from './ultras-steps.ts';

// 機能フラグの行は管理者側のE2E(e2e/admin/ultras-promotion.e2e.test.ts)も書き換えるため、2つのファイルはルートのplaywright.config.tsの直列の組で1つずつ実行する
test.describe('Ultrasの料金ページとプラン管理画面(利用者側)', () => {
  test('機能フラグがオンのとき、未ログインの料金ページにUltrasの区画が出て、特典の3箇条と価格(照会できなければ表示できない旨)と加入のボタンと法的通知へのリンクが見える', async ({
    page,
  }) => {
    await setUltrasPromotionFlag(true);

    await page.goto(PRICING_PAGE_HREF);

    await expect(pricingHeading(page)).toBeVisible();
    const section = ultrasPricingSection(page);
    await expect(section).toBeVisible();
    await expect(benefitItems(section)).toHaveText([...ULTRAS_BENEFITS]);
    await expectUltrasPriceLine(section);
    await expect(ultrasSubscribeButton(page)).toBeVisible();
    await expect(legalNoticeLink(page)).toHaveAttribute(
      'href',
      LEGAL_NOTICE_HREF,
    );
  });

  test('機能フラグがオフのとき、未ログインの料金ページにUltrasの区画が出ず、ページの題名と法的通知へのリンクは出る', async ({
    page,
  }) => {
    await setUltrasPromotionFlag(false);

    await page.goto(PRICING_PAGE_HREF);

    await expect(pricingHeading(page)).toBeVisible();
    await expect(legalNoticeLink(page)).toHaveAttribute(
      'href',
      LEGAL_NOTICE_HREF,
    );
    await expect(ultrasPricingSection(page)).toHaveCount(0);
    await expect(ultrasSubscribeButton(page)).toHaveCount(0);
  });

  test('ログインした利用者が設定のナビゲーションの「プラン」からプラン管理画面を開くと、その項目が現在の項目として示され、未加入の旨が出る', async ({
    page,
  }) => {
    await setUltrasPromotionFlag(true);
    const account = createTestAccount();
    await registerAccount(page, account);

    await openPlanFromSettingsNavigation(page, account);

    await expect(
      planStatusSection(page).getByText(PLAN_NOT_SUBSCRIBED_MESSAGE, {
        exact: true,
      }),
    ).toBeVisible();
  });
});

// 加入の経路はStripeのsandboxに定期課金を作り、実行のたびに1つ増える。不要になったらStripeのダッシュボードで解約する
test.describe('Ultrasへの加入(利用者側。実行のたびにsandboxに定期課金が1つ残る)', () => {
  test('確認済みの利用者がプラン管理画面の「Ultrasに加入」からテストカードで加入すると、決済後のランディングが完了を示し、プラン管理画面が有効を示し、「解約・支払い方法の管理」でCustomer Portalへ移る', async ({
    page,
  }) => {
    test.setTimeout(ULTRAS_FLOW_TIMEOUT_MS);
    await setUltrasPromotionFlag(true);
    const account = createTestAccount();
    await registerAccount(page, account);
    await verifyEmailFromMail(page, account);
    await openPlanFromSettingsNavigation(page, account);

    const start = await startUltrasCheckout(page);
    test.skip(
      start.kind === 'payments_unavailable',
      ULTRAS_CHECKOUT_SKIP_REASON,
    );
    test.skip(
      start.kind === 'price_unavailable',
      ULTRAS_PRICE_UNAVAILABLE_SKIP_REASON,
    );
    if (start.kind !== 'started') {
      return;
    }

    await expectUltrasCheckoutItem(page);
    await preparePaymentWithTestCard(page);
    await confirmPayment(page);

    await expectUltrasCompletedReturn(page);
    await openPlanFromReturn(page);
    await expectPlanStatus(page, 'active');
    await openCustomerPortal(page, account);
  });
});
