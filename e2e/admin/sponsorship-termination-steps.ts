import { expect, type Locator, type Page } from '@playwright/test';

import {
  AUDIT_LOG_LIST_CAPTION,
  AUDIT_LOGS_TITLE,
} from '../../apps/admin/src/components/audit/audit-logs-messages.ts';
import {
  SPONSORSHIP_LIST_CAPTION,
  SPONSORSHIPS_TITLE,
  STATUS_FILTER_LABEL,
  TERMINATE_LABEL,
  terminateButtonName,
  TIER_FILTER_LABEL,
} from '../../apps/admin/src/components/sponsorship/admin-sponsorships-messages.ts';
import {
  REFUND_RESULT_MESSAGES,
  TERMINATE_CONFIRM_LABEL,
  TERMINATE_DIALOG_TITLE,
  TERMINATION_AUTO_REFUND_NOTICE,
  TERMINATION_ESTIMATE_TEXT,
  TERMINATION_RESULT_LABELS,
  terminationDaysLabel,
  terminationResultTitleOf,
} from '../../apps/admin/src/components/sponsorship/termination-messages.ts';
import { SPONSORSHIP_TERMINATE_ACTION } from '../../apps/common-lib/admin/audit-actions/sponsorship.ts';
import {
  MINOR_UNITS_PER_DOLLAR,
  PAYMENT_DISPLAY_CURRENCY,
} from '../../apps/common-lib/payments/money.ts';
import {
  SPONSORSHIP_STATUS_LABELS,
  type SponsorshipStatus,
} from '../../apps/common-lib/sponsorship/sponsorship-status.ts';
import {
  SPONSORSHIP_TIER_LABELS,
  type SponsorshipTier,
} from '../../apps/common-lib/sponsorship/sponsorship-tiers.ts';
import {
  APPLY_FILTER_LABEL,
  AUDITED_ACTION_NOTICE,
  REQUIRED_REASON_LABEL,
} from '../../apps/frontend-lib/utilities/messages/admin-console-messages.ts';
import type { TestAccount } from '../client/auth/account-steps.ts';
import {
  type AdminProfileInput,
  openFromAdminNavigation,
} from '../support/admin-bootstrap.ts';
import {
  REACTION_TIMEOUT_MS,
  RETRY_TIMEOUT_MS,
} from '../support/hydration-retry.ts';
import { executeLocalD1, sqlStringLiteral } from '../support/local-d1.ts';
import {
  type MailpitMessage,
  waitForEmailWithSubject,
} from '../support/mailpit.ts';
import type { PaidSponsorship } from '../support/sponsorship-fixtures.ts';

const SPONSORSHIPS_PATH = '/sponsorships';

const AUDIT_LOGS_PATH = '/audit-logs';

// backend-libのcore/sponsorship/ports.tsのSPONSORSHIP_REFUND_REASONS.terminationの写し。ports.tsは型の読み込みを辿るとルートに無いパッケージへ届くため読み込まない。一致はルートのconfig/sponsorship-contract-copies.unit.test.tsが確かめる
const TERMINATION_REFUND_REASON = 'sponsorship_terminated';

// 強制終了の通知は確定の後に通知の依頼のQueueを経てイベントサーバーが送る
const TERMINATION_NOTICE_TIMEOUT_MS = 60_000;

// 件名はイベントサーバーのメールのテンプレート(sponsorship-termination-notice-template.ts)が決める
export const sponsorshipTerminationNoticeSubject = (
  productName: string,
): string => `${productName}のスポンサー広告掲載を終了しました`;

// 本文の返金の行はイベントサーバーのメールの文言(sponsorship-notice-copy.tsのunexposedRefundLine)が決める
const unexposedRefundLineOf = (days: number, amount: string): string =>
  `未掲載の${String(days)}日分: ${amount}`;

// 金額はセントで持ち、画面とメールはどちらもドルの通貨の表記で示す
export const usdTextOf = (amount: number): string =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: PAYMENT_DISPLAY_CURRENCY,
  }).format(amount / MINOR_UNITS_PER_DOLLAR);

export interface TerminationFigures {
  readonly unexposedDays: number;
  readonly refundEstimate: number;
}

// 選択の部品はハイドレーションの前に押しても開かないため、ハイドレーション済みの画面から管理画面のナビゲーションで開く
export async function openAdminSponsorships(
  page: Page,
  admin: Pick<AdminProfileInput, 'nickname'>,
): Promise<void> {
  await openFromAdminNavigation(page, admin, SPONSORSHIPS_PATH);
  await expect(
    page.getByRole('heading', { level: 1, name: SPONSORSHIPS_TITLE }),
  ).toBeVisible();
}

async function chooseFilterOption(
  page: Page,
  filterLabel: string,
  optionLabel: string,
): Promise<void> {
  const option = page.getByRole('option', { name: optionLabel, exact: true });
  await expect(async () => {
    if (!(await option.isVisible())) {
      await page
        .getByRole('search')
        .getByRole('combobox', { name: filterLabel, exact: true })
        .click();
    }
    await expect(option).toBeVisible({ timeout: REACTION_TIMEOUT_MS });
  }).toPass({ timeout: RETRY_TIMEOUT_MS });
  await option.click();
  await expect(option).toHaveCount(0);
}

// 掲載状況とティアで絞り込み、条件がURLへ届くまで待つ
export async function filterSponsorships(
  page: Page,
  {
    status,
    tier,
  }: { readonly status: SponsorshipStatus; readonly tier: SponsorshipTier },
): Promise<void> {
  await chooseFilterOption(
    page,
    STATUS_FILTER_LABEL,
    SPONSORSHIP_STATUS_LABELS[status],
  );
  await chooseFilterOption(
    page,
    TIER_FILTER_LABEL,
    SPONSORSHIP_TIER_LABELS[tier],
  );
  await page
    .getByRole('search')
    .getByRole('button', { name: APPLY_FILTER_LABEL, exact: true })
    .click();
  await expect(page).toHaveURL(
    (url) =>
      url.pathname === SPONSORSHIPS_PATH &&
      url.searchParams.get('status') === status.toUpperCase() &&
      url.searchParams.get('tier') === tier.toUpperCase(),
  );
}

export const sponsorshipTable = (page: Page): Locator =>
  page.getByRole('table', { name: SPONSORSHIP_LIST_CAPTION });

export const sponsorshipRowOf = (page: Page, sponsorshipId: string): Locator =>
  sponsorshipTable(page).getByRole('row').filter({ hasText: sponsorshipId });

export const terminateButtonOf = (
  scope: Page | Locator,
  sponsorshipId: string,
): Locator =>
  scope.getByRole('button', {
    name: terminateButtonName(sponsorshipId),
    exact: true,
  });

// 一覧の行に申込が掲載状況とともに出ることを確かめる
export async function expectSponsorshipRow(
  page: Page,
  sponsorship: Pick<PaidSponsorship, 'sponsorshipId'>,
  productName: string,
  status: SponsorshipStatus,
): Promise<Locator> {
  const row = sponsorshipRowOf(page, sponsorship.sponsorshipId);
  await expect(row).toHaveCount(1);
  await expect(row).toContainText(productName);
  await expect(row).toContainText(SPONSORSHIP_STATUS_LABELS[status]);
  return row;
}

// 説明の文は日数と金額の要素を挟んで1つの段落になる
const estimateSentenceOf = (
  figures: TerminationFigures,
  sponsorship: Pick<PaidSponsorship, 'amountTotal' | 'days'>,
): string =>
  [
    TERMINATION_ESTIMATE_TEXT.beforeUnexposedDays,
    String(figures.unexposedDays),
    TERMINATION_ESTIMATE_TEXT.beforeRefundEstimate,
    usdTextOf(figures.refundEstimate),
    TERMINATION_ESTIMATE_TEXT.beforeAmountPaid,
    usdTextOf(sponsorship.amountTotal),
    TERMINATION_ESTIMATE_TEXT.beforeDays,
    String(sponsorship.days),
    TERMINATION_ESTIMATE_TEXT.after,
  ].join('');

// 行の「強制終了」から確認のダイアログを開き、照会した未掲載日数と返金目安額が説明に出ることを確かめる
export async function openTerminationDialog(
  page: Page,
  sponsorship: Pick<PaidSponsorship, 'sponsorshipId' | 'amountTotal' | 'days'>,
  figures: TerminationFigures,
): Promise<Locator> {
  await terminateButtonOf(
    sponsorshipRowOf(page, sponsorship.sponsorshipId),
    sponsorship.sponsorshipId,
  ).click();
  const dialog = page.getByRole('dialog', { name: TERMINATE_DIALOG_TITLE });
  await expect(dialog).toContainText(estimateSentenceOf(figures, sponsorship));
  await expect(dialog).toContainText(TERMINATION_AUTO_REFUND_NOTICE);
  await expect(dialog).toContainText(AUDITED_ACTION_NOTICE);
  return dialog;
}

export async function confirmTermination(
  dialog: Locator,
  reason: string,
): Promise<void> {
  await dialog.getByLabel(REQUIRED_REASON_LABEL).fill(reason);
  await dialog
    .getByRole('button', { name: TERMINATE_CONFIRM_LABEL, exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
}

// 定義リストの項目名に一致するdtの直後のddを返す
const definitionOf = (container: Locator, term: string): Locator =>
  container
    .getByRole('term')
    .filter({ hasText: new RegExp(`^${term}$`, 'u') })
    .locator('xpath=following-sibling::dd[1]');

// 確定の結果の区画に、強制終了日・未掲載日数・返金目安額と自動の返金の依頼の結果・購入IDが出て、フォーカスが結果の見出しへ移ることを確かめる
export async function expectTerminationResult(
  page: Page,
  sponsorship: Pick<PaidSponsorship, 'sponsorshipId' | 'purchaseId'>,
  figures: TerminationFigures,
  terminatedOn: string,
): Promise<void> {
  const title = terminationResultTitleOf(sponsorship.sponsorshipId);
  const result = page
    .getByRole('main')
    .getByRole('region', { name: title, exact: true });
  await expect(result).toBeVisible();
  await expect(
    result.getByRole('heading', { level: 2, name: title }),
  ).toBeFocused();
  await expect(
    definitionOf(result, TERMINATION_RESULT_LABELS.terminatedOn).locator(
      'time',
    ),
  ).toHaveAttribute('datetime', terminatedOn);
  await expect(
    definitionOf(result, TERMINATION_RESULT_LABELS.unexposedDays),
  ).toHaveText(terminationDaysLabel(figures.unexposedDays));
  const refund = definitionOf(result, TERMINATION_RESULT_LABELS.refundEstimate);
  await expect(refund).toContainText(usdTextOf(figures.refundEstimate));
  await expect(
    definitionOf(refund, TERMINATION_RESULT_LABELS.requested),
  ).toHaveText(usdTextOf(figures.refundEstimate));
  await expect(refund).toContainText(REFUND_RESULT_MESSAGES.REQUESTED);
  await expect(
    definitionOf(result, TERMINATION_RESULT_LABELS.purchaseId),
  ).toContainText(sponsorship.purchaseId);
}

// 決済の機能の返金の依頼は画面に出ないため、依頼キーで依頼の行を保存先で確かめる。ローカルではStripeへ届かないため、依頼の後の状態は確かめない
export async function expectTerminationRefundRequest(
  sponsorship: Pick<PaidSponsorship, 'purchaseId'>,
  amount: number,
): Promise<void> {
  const reason = TERMINATION_REFUND_REASON;
  const rows = await executeLocalD1(
    `SELECT purchase_id, amount, reason FROM payment_refunds WHERE request_key = ${sqlStringLiteral(`sponsorship:${sponsorship.purchaseId}:${reason}`)};`,
  );
  expect(rows).toEqual([
    { purchase_id: sponsorship.purchaseId, amount, reason },
  ]);
}

export async function terminationAuditLogRows(
  page: Page,
  admin: Pick<AdminProfileInput, 'nickname'>,
  sponsorshipId: string,
): Promise<Locator> {
  await openFromAdminNavigation(page, admin, AUDIT_LOGS_PATH);
  await expect(
    page.getByRole('heading', { level: 1, name: AUDIT_LOGS_TITLE }),
  ).toBeVisible();
  return page
    .getByRole('table', { name: AUDIT_LOG_LIST_CAPTION })
    .getByRole('row')
    .filter({ hasText: SPONSORSHIP_TERMINATE_ACTION.label })
    .filter({ hasText: admin.nickname })
    .filter({ hasText: sponsorshipId });
}

// 強制終了の通知メールが申込者へ届き、本文に理由と返金する未掲載の日数と金額があることを確かめる
export async function expectTerminationNotice(
  account: Pick<TestAccount, 'email'>,
  productName: string,
  {
    reason,
    figures,
    receivedAfter,
  }: {
    readonly reason: string;
    readonly figures: TerminationFigures;
    readonly receivedAfter: Date;
  },
): Promise<MailpitMessage> {
  const mail = await waitForEmailWithSubject(
    {
      to: account.email,
      subject: sponsorshipTerminationNoticeSubject(productName),
      receivedAfter,
    },
    { timeoutMs: TERMINATION_NOTICE_TIMEOUT_MS },
  );
  expect(mail.text).toContain(reason);
  expect(mail.text).toContain(
    unexposedRefundLineOf(
      figures.unexposedDays,
      usdTextOf(figures.refundEstimate),
    ),
  );
  return mail;
}

// 閲覧のみの管理者には、強制終了できる行にも一覧のどこにも「強制終了」が出ないことを確かめる
export async function expectNoTerminateAction(
  page: Page,
  sponsorshipId: string,
): Promise<void> {
  await expect(terminateButtonOf(page, sponsorshipId)).toHaveCount(0);
  await expect(
    sponsorshipTable(page).getByRole('button', { name: TERMINATE_LABEL }),
  ).toHaveCount(0);
}
