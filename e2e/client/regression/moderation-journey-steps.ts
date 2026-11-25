import { expect, type Locator, type Page } from '@playwright/test';

import { REPORT_LIST_CAPTION } from '../../../apps/admin/src/components/reporting/list/report-list-messages.ts';
import { hideCommentDialogCopy } from '../../../apps/admin/src/components/moderation/shared/moderation-messages.ts';
import { REQUIRED_REASON_LABEL } from '../../../apps/frontend-lib/utilities/messages/admin-console-messages.ts';
import { REPORT_CASE_STATUS_LABELS } from '../../../apps/common-lib/reporting/report-labels.ts';
import {
  type AdminProfileInput,
  openFromAdminNavigation,
} from '../../support/admin-bootstrap.ts';
import {
  REACTION_TIMEOUT_MS,
  RETRY_TIMEOUT_MS,
} from '../../support/hydration-retry.ts';
import {
  type MailpitMessage,
  waitForEmailWithSubject,
} from '../../support/mailpit.ts';

const REPORTS_PATH = '/reports';

// 措置と対応結果の通知は確定の後に依頼のQueueを経てイベントサーバーが送る
const NOTICE_TIMEOUT_MS = 60_000;

// 件名はイベントサーバーのメールのテンプレート(ugc-moderation/comment-hidden-template.ts)が決める
const COMMENT_HIDDEN_SUBJECT = 'コメントの公開が停止されました';

// 件名はイベントサーバーのメールのテンプレート(content-reporting/report-notice-copy.tsのREPORT_OUTCOME_SUBJECT)が決める
const REPORT_OUTCOME_SUBJECT = '通報の対応結果についてのお知らせ';

// 管理画面の通報の共通の文言(components/reporting/shared/report-messages.ts)の写し。そのファイルは型の読み込みで画面の部品まで辿り、JSXを扱わないルートの型検査で読めないため写す
const RESOLVED_MESSAGE = '対応済にしました。';

export interface ReportedCommentProduct {
  readonly name: string;
}

// 一覧ではコメントの対象を「<プロダクト名>へのコメント」で示す
const commentTargetLabel = ({ name }: ReportedCommentProduct): string =>
  `${name}へのコメント`;

const hideActionName = (product: ReportedCommentProduct): string =>
  `${commentTargetLabel(product)}を非公開にする`;

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

// 管理メニューから通報の一覧を開き、プロダクトのコメントの案件の行の措置から、理由を添えてコメントを非公開にして案件を対応済にする。確定の後は行の状態が替わり、措置の操作が消えることを確かめる
export async function hideReportedCommentFromList(
  page: Page,
  admin: Pick<AdminProfileInput, 'nickname'>,
  product: ReportedCommentProduct,
  reason: string,
): Promise<void> {
  await openFromAdminNavigation(page, admin, REPORTS_PATH);
  const row = page
    .getByRole('table', { name: REPORT_LIST_CAPTION, exact: true })
    .getByRole('row')
    .filter({ hasText: commentTargetLabel(product) });
  // 一覧は画面の表示の後に取得するため、既定の検証の待ちより長く待つ
  await expect(row).toHaveCount(1, { timeout: RETRY_TIMEOUT_MS });
  const hideButton = row.getByRole('button', {
    name: hideActionName(product),
    exact: true,
  });
  const copy = hideCommentDialogCopy(null);
  const dialog = await openDialogBy(page, hideButton, copy.title);
  await dialog.getByLabel(REQUIRED_REASON_LABEL, { exact: true }).fill(reason);
  await dialog
    .getByRole('button', { name: copy.confirmLabel, exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText(RESOLVED_MESSAGE, { exact: true })).toBeVisible();
  await expect(row).toContainText(REPORT_CASE_STATUS_LABELS.resolved);
  await expect(hideButton).toHaveCount(0);
}

// コメントの非公開化の通知が投稿者へ届き、本文にプロダクトの名称と入力した理由があることを確かめる
export async function expectCommentHiddenNotice(
  email: string,
  {
    productName,
    reason,
  }: { readonly productName: string; readonly reason: string },
  receivedAfter: Date,
): Promise<MailpitMessage> {
  const mail = await waitForEmailWithSubject(
    { to: email, subject: COMMENT_HIDDEN_SUBJECT, receivedAfter },
    { timeoutMs: NOTICE_TIMEOUT_MS },
  );
  expect(mail.text).toContain(productName);
  expect(mail.text).toContain(reason);
  return mail;
}

// 対応結果の通知が申出者へ届き、本文に対象のコメントのプロダクトの名称と対応した旨と管理者の理由があることを確かめる
export async function expectCommentReportResolvedNotice(
  email: string,
  {
    productName,
    reason,
  }: { readonly productName: string; readonly reason: string },
  receivedAfter: Date,
): Promise<MailpitMessage> {
  const mail = await waitForEmailWithSubject(
    { to: email, subject: REPORT_OUTCOME_SUBJECT, receivedAfter },
    { timeoutMs: NOTICE_TIMEOUT_MS },
  );
  expect(mail.text).toContain(
    `通報いただいた${productName}へのコメントについて、運営者が確認し、対応しました。`,
  );
  expect(mail.text).toContain(reason);
  return mail;
}
