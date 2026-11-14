import { BILLING_HISTORY_HREF } from '../../apps/client/src/components/payments/checkout-messages.ts';
import { CHECKOUT_CONSENT_VERSION } from '../../apps/common-lib/payments/checkout-consent.ts';
import { PURCHASE_KIND_LABELS } from '../../apps/common-lib/payments/purchase-kinds.ts';
import { executeLocalD1, sqlStringLiteral } from '../support/local-d1.ts';
import { waitForEmailWithSubject } from '../support/mailpit.ts';
import {
  installCspViolationRecorder,
  readCspViolations,
} from '../support/security-assertions.ts';
import {
  createTestAccount,
  registerAccount,
  verifyEmailFromMail,
} from './auth/account-steps.ts';
import { expect, test } from './auth/auth-test.ts';
import {
  billingHeading,
  openBillingFromSettingsNavigation,
  stripeScripts,
} from './billing-steps.ts';
import {
  CHECKOUT_FLOW_TIMEOUT_MS,
  confirmPayment,
  expectCompletedReturn,
  expectSmokeCheckoutSummary,
  expectSmokePaymentRecord,
  openBillingFromReturn,
  preparePaymentWithTestCard,
  SMOKE_CHECKOUT_SKIP_REASON,
  startSmokeCheckout,
} from './checkout-steps.ts';

const PURCHASE_CONFIRMATION_SUBJECT = '購入が完了しました';

// 同意の記録は画面に出ないため、同意の日時と版が購入の記録に保存されたことを保存先で確かめる
async function expectConsentRecorded(purchaseId: string): Promise<void> {
  const rows = await executeLocalD1(
    `SELECT status, consent_version, consented_at IS NOT NULL AS consented FROM payment_purchases WHERE id = ${sqlStringLiteral(purchaseId)};`,
  );
  expect(rows).toEqual([
    {
      status: 'fulfilled',
      consent_version: CHECKOUT_CONSENT_VERSION,
      consented: 1,
    },
  ]);
}

test.describe('疎通確認の決済(利用者側)', () => {
  test('決済履歴の開始のボタンから決済画面へ進み、表示事項を確かめて同意しテストカードで支払うと、決済後のランディングが完了を示し、決済履歴に記録され、購入確認メールが届き、CSPの違反が出ない', async ({
    page,
  }) => {
    test.setTimeout(CHECKOUT_FLOW_TIMEOUT_MS);
    await installCspViolationRecorder(page);
    const account = createTestAccount();
    await registerAccount(page, account);
    await verifyEmailFromMail(page, account);
    const startedAt = new Date();
    await openBillingFromSettingsNavigation(page, account);

    const start = await startSmokeCheckout(page);
    test.skip(
      start.kind === 'payments_unavailable',
      SMOKE_CHECKOUT_SKIP_REASON,
    );
    if (start.kind !== 'started') {
      return;
    }

    await expectSmokeCheckoutSummary(page);
    await preparePaymentWithTestCard(page);
    await expect(stripeScripts(page).first()).toBeAttached();
    expect(await readCspViolations(page), '決済画面のCSPの違反').toEqual([]);
    await confirmPayment(page);

    await expectCompletedReturn(page);
    await expectConsentRecorded(start.purchaseId);
    await openBillingFromReturn(page);
    await expect(page).toHaveURL(BILLING_HISTORY_HREF);
    await expect(billingHeading(page)).toBeVisible();
    await expectSmokePaymentRecord(page);
    expect(
      await readCspViolations(page),
      '決済後のランディングと決済履歴のCSPの違反',
    ).toEqual([]);

    const mail = await waitForEmailWithSubject({
      to: account.email,
      subject: PURCHASE_CONFIRMATION_SUBJECT,
      receivedAfter: startedAt,
    });
    expect(mail.text).toContain(PURCHASE_KIND_LABELS.payments_smoke);
    expect(
      mail.links.some(
        (link) => new URL(link).pathname === BILLING_HISTORY_HREF,
      ),
      '決済履歴への導線',
    ).toBe(true);
  });
});
