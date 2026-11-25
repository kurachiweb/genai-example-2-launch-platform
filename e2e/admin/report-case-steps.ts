import { expect, type Locator, type Page } from '@playwright/test';

import { hideProductDialogCopy } from '../../apps/admin/src/components/moderation/shared/moderation-messages.ts';
import {
  INFRINGEMENT_INQUIRY_DIALOG_COPY,
  REPORT_CASE_DETAIL_COPY,
  REPORT_INQUIRY_COPY,
  REPORT_STATUS_CHANGE_COPY,
  reportStatusChangeTitle,
} from '../../apps/admin/src/components/reporting/case/report-case-messages.ts';
import {
  REPORT_FILTER_LABELS,
  REPORT_LIST_CAPTION,
} from '../../apps/admin/src/components/reporting/list/report-list-messages.ts';
import {
  NO_PRODUCT_REPORTS_MESSAGE,
  OPEN_REPORT_CASE_LABEL,
  OPEN_REPORT_CASE_LINK_LABEL,
  PRODUCT_REPORTS_TITLE,
} from '../../apps/admin/src/components/reporting/product-detail/product-reports-messages.ts';
import {
  INQUIRY_RESPONSE_DAYS,
  type ReportCaseStatus,
} from '../../apps/common-lib/reporting/report-case-rules.ts';
import {
  REPORT_CASE_STATUS_LABELS,
  REPORT_RESOLUTION_LABELS,
} from '../../apps/common-lib/reporting/report-labels.ts';
import { REPORT_CATEGORY_INFRINGEMENT_NAME } from '../../apps/common-lib/reporting/report-rules.ts';
import {
  APPLY_FILTER_LABEL,
  OPTIONAL_REASON_LABEL,
  REQUIRED_REASON_LABEL,
} from '../../apps/frontend-lib/utilities/messages/admin-console-messages.ts';
import {
  type AdminProfileInput,
  openFromAdminNavigation,
} from '../support/admin-bootstrap.ts';
import {
  REACTION_TIMEOUT_MS,
  RETRY_TIMEOUT_MS,
} from '../support/hydration-retry.ts';
import {
  type MailpitMessage,
  waitForEmailWithSubject,
} from '../support/mailpit.ts';

const { sections, items } = REPORT_CASE_DETAIL_COPY;

// 件名はイベントサーバーのメールのテンプレート(content-reporting/report-notice-copy.tsのREPORT_OUTCOME_SUBJECT)が決め、申出者と投稿者で同じ
const REPORT_OUTCOME_SUBJECT = '通報の対応結果についてのお知らせ';

// 申出者と投稿者の本文が共に持つ却下の文(report-notice-copy.tsのoutcomeTailとposterRejectionLead)
const REJECTED_NOTICE_TEXT = '通報を却下しました。';

// 照会の件名(report-notice-copy.tsのINFRINGEMENT_INQUIRY_SUBJECT)
const INFRINGEMENT_INQUIRY_SUBJECT =
  '投稿内容の権利侵害についてご確認をお願いします';

// プロダクトへの照会と対応結果の本文の冒頭(report-notice-copy.tsのinfringementInquiryLeadとreportOutcomeLead)
const productInquiryLead = (productName: string): string =>
  `プロダクト『${productName}』について、権利を侵害しているとの申出がありました。`;

const productResolvedLead = (productName: string): string =>
  `通報いただいたプロダクト『${productName}』について、運営者が確認し、対応しました。`;

// 却下の通知は確定の後に依頼のQueueを経てイベントサーバーが送る
const REPORT_NOTICE_TIMEOUT_MS = 60_000;

// 管理画面の通報の共通の文言(components/reporting/shared/report-messages.ts)の写し。そのファイルは型の読み込みで画面の部品まで辿り、JSXを扱わないルートの型検査で読めないため写す
const REPORT_CASE_PAGE_TITLE = '通報の案件の詳細';

const INQUIRY_SENT_MESSAGE = '照会を送りました。';

const REPORTS_PATH = '/reports';

const DASHBOARD_PATH = '/';

// ダッシュボードの未対応の通報のカード(components/reporting/dashboard/unhandled-reports-messages.ts)の写し。そのファイルは通報の共通の文言を経て画面の部品まで辿るため写す
const UNHANDLED_REPORTS_TITLE = '未対応の通報';

const NO_UNHANDLED_REPORTS_MESSAGE = '未対応の通報はありません。';

const UNHANDLED_COUNT_PATTERN = /^[\d,]+件$/u;

const INFRINGEMENT_BREAKDOWN_PATTERN = /^\(うち権利侵害[\d,]+件\)$/u;

// 件数を読むたびにダッシュボードを読み込み直すため、テスト全体の期限まで待たずに失敗させる
const COUNT_POLL_TIMEOUT_MS = 30_000;

// 照会と措置による対応済の通知は確定の後に依頼のQueueを経てイベントサーバーが送る
const REPORT_MAIL_TIMEOUT_MS = 60_000;

const INQUIRY_RESPONSE_MS = INQUIRY_RESPONSE_DAYS * 24 * 60 * 60 * 1000;

// 管理画面の通報の共通の文言(report-messages.tsのreportTargetLabelOf)の写し。一覧と詳細ではプロダクトを「<名称>(<ハンドル>)」で示す
const productTargetLabel = ({ name, handle }: ReportedProduct): string =>
  `${name}(${handle})`;

const productMeasureActionName = (product: ReportedProduct): string =>
  `${productTargetLabel(product)}を非公開にする`;

export interface ReportedProduct {
  readonly handle: string;
  readonly name: string;
}

export interface UnhandledReportCounts {
  readonly open: number;
  readonly infringementOpen: number;
}

const REJECT_DIALOG_COPY = Object.freeze({
  title: 'この通報を却下しますか?',
  confirmLabel: '却下する',
});

const STATUS_CHANGED_MESSAGES: Readonly<Record<ReportCaseStatus, string>> =
  Object.freeze({
    open: '未対応に戻しました。',
    in_progress: '対応中にしました。',
    resolved: '対応済にしました。',
    rejected: '却下しました。',
  });

// 一覧と詳細の却下の操作は、読み上げで区別できるよう対象の表示名(コメントは「<プロダクト名>へのコメント」)を含む名前を持つ
const commentRejectActionName = (productName: string): string =>
  `${productName}へのコメントの通報を却下する`;

const categoryCountLabel = (name: string, count: number): string =>
  `${name} ${String(count)}件`;

const sectionOf = (page: Page, title: string): Locator =>
  page.getByRole('main').getByRole('region', { name: title, exact: true });

const statusSectionOf = (page: Page): Locator =>
  sectionOf(page, sections.status);

const operationsSectionOf = (page: Page): Locator =>
  sectionOf(page, sections.operations);

// 詳細の項目は名前と値の組の一覧で表示するため、項目の名前の直後の値を返す
const statusItemValue = (page: Page, term: string): Locator => {
  const section = statusSectionOf(page);
  return section
    .getByRole('term')
    .and(section.getByText(term, { exact: true }))
    .locator('xpath=following-sibling::dd[1]');
};

const statusItemTerm = (page: Page, term: string): Locator => {
  const section = statusSectionOf(page);
  return section
    .getByRole('term')
    .and(section.getByText(term, { exact: true }));
};

// メニューへの登録とは独立に確かめるため、案件の詳細のURLを直接開く
export async function openReportCaseDetail(
  page: Page,
  caseId: string,
): Promise<void> {
  await page.goto(`/reports/${encodeURIComponent(caseId)}`);
  await expect(
    page.getByRole('heading', {
      level: 1,
      name: REPORT_CASE_PAGE_TITLE,
      exact: true,
    }),
  ).toBeVisible();
}

export async function expectReportCaseStatus(
  page: Page,
  status: ReportCaseStatus,
): Promise<void> {
  await expect(statusItemValue(page, items.status)).toHaveText(
    REPORT_CASE_STATUS_LABELS[status],
  );
}

// カテゴリごとの件数の内訳が、指定したカテゴリの件数だけであることを確かめる
export async function expectReportCaseBreakdown(
  page: Page,
  counts: readonly { readonly name: string; readonly count: number }[],
): Promise<void> {
  await expect(
    statusItemValue(page, items.categoryCounts).getByRole('listitem'),
  ).toHaveText(
    counts.map(({ name, count }) => categoryCountLabel(name, count)),
  );
}

// 開いた直後はハイドレーションの前に押した操作が効かないため、確認のダイアログが開くまで押し直す
async function openDialogBy(
  page: Page,
  button: Locator,
  title: string,
): Promise<Locator> {
  const dialog = page.getByRole('dialog', { name: title, exact: true });
  await expect(async () => {
    if (!(await dialog.isVisible())) {
      await button.click({ timeout: REACTION_TIMEOUT_MS });
    }
    await expect(dialog).toBeVisible({ timeout: REACTION_TIMEOUT_MS });
  }).toPass({ timeout: RETRY_TIMEOUT_MS });
  return dialog;
}

async function confirmWithReason(
  page: Page,
  dialog: Locator,
  confirmLabel: string,
  reason: string,
  changedMessage: string,
  reasonLabel: string = REQUIRED_REASON_LABEL,
): Promise<void> {
  await dialog.getByLabel(reasonLabel, { exact: true }).fill(reason);
  await dialog.getByRole('button', { name: confirmLabel, exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText(changedMessage, { exact: true })).toBeVisible();
}

// 詳細の操作の区画からコメントへの通報を理由を添えて却下し、完了の種類と理由が表示されることを確かめる
export async function rejectCommentReportCase(
  page: Page,
  productName: string,
  reason: string,
): Promise<void> {
  const copy = REJECT_DIALOG_COPY;
  const rejectButton = operationsSectionOf(page).getByRole('button', {
    name: commentRejectActionName(productName),
    exact: true,
  });
  const dialog = await openDialogBy(page, rejectButton, copy.title);
  await confirmWithReason(
    page,
    dialog,
    copy.confirmLabel,
    reason,
    STATUS_CHANGED_MESSAGES.rejected,
  );
  await expectReportCaseStatus(page, 'rejected');
  await expect(statusItemValue(page, items.resolution)).toHaveText(
    REPORT_CASE_STATUS_LABELS.rejected,
  );
  await expect(statusItemValue(page, items.closingReason)).toHaveText(reason);
  await expect(statusItemTerm(page, items.closedAt)).toHaveCount(1);
  await expect(rejectButton).toHaveCount(0);
}

// 対応ステータスの変更で状態を選び、理由を添えて手で変更する
export async function changeReportCaseStatus(
  page: Page,
  to: ReportCaseStatus,
  reason: string,
): Promise<void> {
  await submitStatusChange(page, to, reason, REQUIRED_REASON_LABEL);
}

// 未対応から対応中への変更は理由が任意のため、任意の理由の欄へ理由を添える
export async function startReportCaseProgress(
  page: Page,
  reason: string,
): Promise<void> {
  await submitStatusChange(page, 'in_progress', reason, OPTIONAL_REASON_LABEL);
}

async function submitStatusChange(
  page: Page,
  to: ReportCaseStatus,
  reason: string,
  reasonLabel: string,
): Promise<void> {
  const operations = operationsSectionOf(page);
  const select = operations.getByRole('combobox', {
    name: REPORT_STATUS_CHANGE_COPY.nextStatus,
    exact: true,
  });
  const option = page.getByRole('option', {
    name: REPORT_CASE_STATUS_LABELS[to],
    exact: true,
  });
  await expect(async () => {
    if (!(await option.isVisible())) {
      await select.click({ timeout: REACTION_TIMEOUT_MS });
    }
    await expect(option).toBeVisible({ timeout: REACTION_TIMEOUT_MS });
  }).toPass({ timeout: RETRY_TIMEOUT_MS });
  await option.click();
  await expect(select).toHaveText(REPORT_CASE_STATUS_LABELS[to]);
  const dialog = await openDialogBy(
    page,
    operations.getByRole('button', {
      name: REPORT_STATUS_CHANGE_COPY.submit,
      exact: true,
    }),
    reportStatusChangeTitle(REPORT_CASE_STATUS_LABELS[to]),
  );
  await confirmWithReason(
    page,
    dialog,
    REPORT_STATUS_CHANGE_COPY.confirm,
    reason,
    STATUS_CHANGED_MESSAGES[to],
    reasonLabel,
  );
  await expectReportCaseStatus(page, to);
}

// 完了から戻した案件は完了の種類・理由・日時を持たない
export async function expectNoClosingRecord(page: Page): Promise<void> {
  for (const term of [items.resolution, items.closingReason, items.closedAt]) {
    await expect(statusItemTerm(page, term)).toHaveCount(0);
  }
}

// 却下の通知が宛先へ届き、本文に却下の文と管理者の理由があることを確かめる
export async function expectRejectionNotice(
  email: string,
  reason: string,
  receivedAfter: Date,
): Promise<MailpitMessage> {
  const mail = await waitForEmailWithSubject(
    { to: email, subject: REPORT_OUTCOME_SUBJECT, receivedAfter },
    { timeoutMs: REPORT_NOTICE_TIMEOUT_MS },
  );
  expect(mail.text).toContain(REJECTED_NOTICE_TEXT);
  expect(mail.text).toContain(reason);
  return mail;
}

const inquirySectionOf = (page: Page): Locator =>
  sectionOf(page, sections.inquiry);

const inquiryItemValue = (page: Page, term: string): Locator => {
  const section = inquirySectionOf(page);
  return section
    .getByRole('term')
    .and(section.getByText(term, { exact: true }))
    .locator('xpath=following-sibling::dd[1]');
};

// Radix UIの選択の部品はハイドレーションの前に押すと開かないため、選択肢が現れるまで押し直す
async function chooseOption(
  page: Page,
  select: Locator,
  optionName: string,
): Promise<void> {
  const option = page.getByRole('option', { name: optionName, exact: true });
  await expect(async () => {
    if (!(await option.isVisible())) {
      await select.click({ timeout: REACTION_TIMEOUT_MS });
    }
    await expect(option).toBeVisible({ timeout: REACTION_TIMEOUT_MS });
  }).toPass({ timeout: RETRY_TIMEOUT_MS });
  await option.click();
  await expect(select).toHaveText(optionName);
}

// 管理メニューから通報の一覧を開き、カテゴリを「権利侵害」で絞り込んだ一覧の対象のリンクから案件の詳細を開く
export async function openReportCaseFromInfringementList(
  page: Page,
  admin: Pick<AdminProfileInput, 'nickname'>,
  product: ReportedProduct,
): Promise<void> {
  await openFromAdminNavigation(page, admin, REPORTS_PATH);
  await chooseOption(
    page,
    page.getByRole('combobox', {
      name: REPORT_FILTER_LABELS.category,
      exact: true,
    }),
    REPORT_CATEGORY_INFRINGEMENT_NAME,
  );
  await page.getByRole('button', { name: APPLY_FILTER_LABEL }).click();
  await expect(page).toHaveURL((url) => url.searchParams.has('category'));
  await page
    .getByRole('table', { name: REPORT_LIST_CAPTION, exact: true })
    .getByRole('link', { name: productTargetLabel(product), exact: true })
    .click();
  await expect(
    page.getByRole('heading', {
      level: 1,
      name: REPORT_CASE_PAGE_TITLE,
      exact: true,
    }),
  ).toBeVisible();
}

// 権利侵害の照会の区画から照会の内容を入力して送る。照会の操作は対応中の案件にだけ出る
export async function sendInfringementInquiry(
  page: Page,
  message: string,
): Promise<void> {
  const dialog = await openDialogBy(
    page,
    inquirySectionOf(page).getByRole('button', {
      name: REPORT_INQUIRY_COPY.send,
      exact: true,
    }),
    INFRINGEMENT_INQUIRY_DIALOG_COPY.title,
  );
  await dialog
    .getByLabel(INFRINGEMENT_INQUIRY_DIALOG_COPY.messageLabel, { exact: true })
    .fill(message);
  await dialog
    .getByRole('button', {
      name: INFRINGEMENT_INQUIRY_DIALOG_COPY.confirm,
      exact: true,
    })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByText(INQUIRY_SENT_MESSAGE, { exact: true }),
  ).toBeVisible();
}

// 最後の照会の内容と、送信の日時から決まった日数の後の回答の期限が詳細に出ることを確かめる
export async function expectInfringementInquiryShown(
  page: Page,
  message: string,
): Promise<void> {
  await expect(inquiryItemValue(page, REPORT_INQUIRY_COPY.message)).toHaveText(
    message,
  );
  const sentAt = await inquiryItemValue(page, REPORT_INQUIRY_COPY.lastInquiry)
    .locator('time')
    .getAttribute('datetime');
  const deadline = await inquiryItemValue(page, REPORT_INQUIRY_COPY.deadline)
    .locator('time')
    .getAttribute('datetime');
  expect(sentAt).not.toBeNull();
  expect(deadline).not.toBeNull();
  expect(Date.parse(deadline ?? '') - Date.parse(sentAt ?? '')).toBe(
    INQUIRY_RESPONSE_MS,
  );
  await expect(
    inquirySectionOf(page).getByText(REPORT_INQUIRY_COPY.overdue, {
      exact: true,
    }),
  ).toHaveCount(0);
}

// 照会のメールが投稿者へ届き、本文に対象のプロダクトと照会の内容と回答の期限があることを確かめる
export async function expectInfringementInquiryNotice(
  email: string,
  {
    productName,
    message,
  }: { readonly productName: string; readonly message: string },
  receivedAfter: Date,
): Promise<MailpitMessage> {
  const mail = await waitForEmailWithSubject(
    { to: email, subject: INFRINGEMENT_INQUIRY_SUBJECT, receivedAfter },
    { timeoutMs: REPORT_MAIL_TIMEOUT_MS },
  );
  expect(mail.text).toContain(productInquiryLead(productName));
  expect(mail.text).toContain(message);
  expect(mail.text).toContain(REPORT_INQUIRY_COPY.deadline);
  return mail;
}

// 詳細の操作の区画からプロダクトを理由を添えて非公開にし、案件が措置による対応済になることを確かめる
export async function hideProductToResolveReportCase(
  page: Page,
  product: ReportedProduct,
  reason: string,
): Promise<void> {
  const copy = hideProductDialogCopy(product.name);
  const hideButton = operationsSectionOf(page).getByRole('button', {
    name: productMeasureActionName(product),
    exact: true,
  });
  const dialog = await openDialogBy(page, hideButton, copy.title);
  await confirmWithReason(
    page,
    dialog,
    copy.confirmLabel,
    reason,
    STATUS_CHANGED_MESSAGES.resolved,
  );
  await expectReportCaseStatus(page, 'resolved');
  await expect(statusItemValue(page, items.resolution)).toHaveText(
    REPORT_RESOLUTION_LABELS['product.hide'],
  );
  await expect(statusItemValue(page, items.closingReason)).toHaveText(reason);
  await expect(hideButton).toHaveCount(0);
}

// 対応結果の通知が申出者の連絡先へ届き、本文に対応した旨と管理者の理由があることを確かめる
export async function expectResolvedNotice(
  email: string,
  {
    productName,
    reason,
  }: { readonly productName: string; readonly reason: string },
  receivedAfter: Date,
): Promise<MailpitMessage> {
  const mail = await waitForEmailWithSubject(
    { to: email, subject: REPORT_OUTCOME_SUBJECT, receivedAfter },
    { timeoutMs: REPORT_MAIL_TIMEOUT_MS },
  );
  expect(mail.text).toContain(productResolvedLead(productName));
  expect(mail.text).toContain(reason);
  return mail;
}

async function readUnhandledReportCountsOnce(
  page: Page,
): Promise<UnhandledReportCounts> {
  await page.goto(DASHBOARD_PATH);
  const card = page
    .getByRole('main')
    .getByRole('region', { name: UNHANDLED_REPORTS_TITLE, exact: true });
  const empty = card.getByText(NO_UNHANDLED_REPORTS_MESSAGE, { exact: true });
  const open = card.getByText(UNHANDLED_COUNT_PATTERN);
  await expect(empty.or(open)).toBeVisible();
  if (await empty.isVisible()) {
    return { open: 0, infringementOpen: 0 };
  }
  const numberOf = async (locator: Locator): Promise<number> =>
    Number.parseInt((await locator.innerText()).replaceAll(/\D/gu, ''), 10);
  return {
    open: await numberOf(open),
    infringementOpen: await numberOf(
      card.getByText(INFRINGEMENT_BREAKDOWN_PATTERN),
    ),
  };
}

// 件数のカードは表示の後に取得するため、ダッシュボードを読み込み直して最新の件数を読む。条件を渡すと、満たすまで読み込み直す
export async function readUnhandledReportCounts(
  page: Page,
  until?: (counts: UnhandledReportCounts) => boolean,
): Promise<UnhandledReportCounts> {
  let counts = await readUnhandledReportCountsOnce(page);
  if (until === undefined) {
    return counts;
  }
  await expect
    .poll(
      async () => {
        counts = await readUnhandledReportCountsOnce(page);
        return until(counts);
      },
      { timeout: COUNT_POLL_TIMEOUT_MS },
    )
    .toBe(true);
  return counts;
}

// 管理画面のプロダクトの詳細の受け付けた通報の区画で、累計の件数と未完了の案件の状態を確かめる。openStatusがnullなら未完了の案件が無い
export async function expectProductReportsSection(
  page: Page,
  {
    count,
    openStatus,
  }: {
    readonly count: number;
    readonly openStatus: Extract<
      ReportCaseStatus,
      'open' | 'in_progress'
    > | null;
  },
): Promise<void> {
  const section = page
    .getByRole('main')
    .getByRole('region', { name: PRODUCT_REPORTS_TITLE, exact: true });
  await expect(
    count === 0
      ? section.getByText(NO_PRODUCT_REPORTS_MESSAGE, { exact: true })
      : section.getByText(`${String(count)}件`, { exact: true }),
  ).toBeVisible();
  const openCaseTerm = section
    .getByRole('term')
    .and(section.getByText(OPEN_REPORT_CASE_LABEL, { exact: true }));
  if (openStatus === null) {
    await expect(openCaseTerm).toHaveCount(0);
    return;
  }
  const value = openCaseTerm.locator('xpath=following-sibling::dd[1]');
  await expect(value).toContainText(REPORT_CASE_STATUS_LABELS[openStatus]);
  await expect(
    value.getByRole('link', { name: OPEN_REPORT_CASE_LINK_LABEL, exact: true }),
  ).toBeVisible();
}
