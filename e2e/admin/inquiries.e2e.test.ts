import { readFile } from 'node:fs/promises';

import type { Locator, Page } from '@playwright/test';

import {
  CATEGORY_LABEL,
  CONTACT_EMAIL_LABEL,
  GUEST_BODY_LABEL,
  GUEST_NICKNAME_LABEL,
  GUEST_REPLY_NOTICE,
  INQUIRY_KIND_LABELS,
  KIND_LABEL,
  STATUS_LABEL,
  UNHANDLED_INQUIRIES_TITLE,
} from '../../apps/admin/src/components/inquiry/admin-inquiries-messages.ts';
import {
  CHANGE_STATUS_CONFIRM_LABEL,
  CHANGE_STATUS_LABEL,
  changeStatusTitle,
  NEXT_STATUS_LABEL,
  REPLY_BODY_LABEL,
  REPLY_SECTION_TITLE,
  REPLY_SENT_MESSAGE,
  REPLY_SUBMIT_LABEL,
  STATUS_CHANGED_MESSAGE,
} from '../../apps/admin/src/components/inquiry/inquiry-operations-messages.ts';
import {
  INQUIRY_MESSAGE_FORM_LABEL,
  INQUIRY_STATUS_LABEL,
} from '../../apps/client/src/components/inquiry/inquiry-chat-messages.ts';
import {
  BODY_LABEL,
  SUBMIT_LABEL,
} from '../../apps/client/src/components/inquiry/inquiry-contact-messages.ts';
import { INQUIRY_CATEGORY_OTHER_NAME } from '../../apps/common-lib/inquiry/inquiry-category-constants.ts';
import {
  INQUIRY_STATUS_LABELS,
  type InquiryStatus,
} from '../../apps/common-lib/inquiry/inquiry-status.ts';
import { INQUIRY_ATTACHMENTS_LABEL } from '../../apps/frontend-lib/utilities/messages/inquiry-display-messages.ts';
import {
  ADMIN_FLOW_TIMEOUT_MS,
  openFromAdminNavigation,
  signInAsNewAdmin,
} from '../support/admin-bootstrap.ts';
import { waitForEmailWithSubject } from '../support/mailpit.ts';
import {
  createTestAccount,
  registerAccount,
} from '../client/auth/account-steps.ts';
import {
  ATTACHMENT_FILE_NAME,
  chatHeading,
  chatLog,
  createGuestInquiryInput,
  expectGuestInquiryCompleted,
  INQUIRY_FLOW_TIMEOUT_MS,
  openContactForm,
  requiredField,
  submitGuestInquiry,
  submitMemberInquiry,
  uniqueText,
} from '../client/inquiry/inquiry-steps.ts';
import { expect, test } from './client-page-test.ts';
import {
  INQUIRIES_PATH,
  inquiryDetailValue,
  inquiryListRow,
  openInquiryDetailFromList,
  openInquiryFromList,
} from './inquiry-steps.ts';

// 管理者の用意と利用者の登録・問い合わせの送信を1つの流れで行うため、両方の待ちの長さを足す
test.describe.configure({
  timeout: ADMIN_FLOW_TIMEOUT_MS + INQUIRY_FLOW_TIMEOUT_MS,
});

// イベントサーバーのメールのテンプレート(INQUIRY_REPLY_TEMPLATE)の件名。テンプレートのファイルはWorkersの型を前提とする部品を読み込み、ルートの型検査に含められないため写して持つ
const REPLY_NOTIFICATION_SUBJECT = 'お問い合わせに返信がありました';

const DASHBOARD_PATH = '/';

const UNHANDLED_COUNT_PATTERN = /^[\d,]+件$/u;

// 件数を読むたびにダッシュボードを読み込み直すため、テスト全体の期限まで待たずに失敗させる
const COUNT_POLL_TIMEOUT_MS = 30_000;

const adminMessageLog = (page: Page): Locator =>
  page.getByRole('main').getByRole('log');

const messageItem = (log: Locator, body: string): Locator =>
  log.getByRole('listitem').filter({ hasText: body });

const attachmentLink = (message: Locator): Locator =>
  message
    .getByRole('list', { name: INQUIRY_ATTACHMENTS_LABEL, exact: true })
    .getByRole('link', { name: ATTACHMENT_FILE_NAME });

async function replyToInquiry(page: Page, body: string): Promise<void> {
  const section = page
    .getByRole('main')
    .getByRole('region', { name: REPLY_SECTION_TITLE, exact: true });
  await section.getByLabel(REPLY_BODY_LABEL, { exact: true }).fill(body);
  await section
    .getByRole('button', { name: REPLY_SUBMIT_LABEL, exact: true })
    .click();
  await expect(page.getByText(REPLY_SENT_MESSAGE)).toBeVisible();
}

async function changeInquiryStatus(
  page: Page,
  status: InquiryStatus,
): Promise<void> {
  const main = page.getByRole('main');
  await main
    .getByRole('combobox', { name: NEXT_STATUS_LABEL, exact: true })
    .click();
  await page
    .getByRole('option', { name: INQUIRY_STATUS_LABELS[status], exact: true })
    .click();
  await main
    .getByRole('button', { name: CHANGE_STATUS_LABEL, exact: true })
    .click();
  const dialog = page.getByRole('dialog', {
    name: changeStatusTitle(INQUIRY_STATUS_LABELS[status]),
  });
  await dialog
    .getByRole('button', { name: CHANGE_STATUS_CONFIRM_LABEL, exact: true })
    .click();
  await expect(page.getByText(STATUS_CHANGED_MESSAGE)).toBeVisible();
  await expect(dialog).toHaveCount(0);
  await expect(inquiryDetailValue(page, STATUS_LABEL)).toHaveText(
    INQUIRY_STATUS_LABELS[status],
  );
}

// 件数のカードは表示の後に取得するため、ページを読み込み直して最新の件数を読む
async function readUnhandledCount(page: Page): Promise<number> {
  await page.goto(DASHBOARD_PATH);
  const count = page
    .getByRole('region', { name: UNHANDLED_INQUIRIES_TITLE, exact: true })
    .getByText(UNHANDLED_COUNT_PATTERN);
  await expect(count).toBeVisible();
  return Number.parseInt((await count.innerText()).replaceAll(/\D/gu, ''), 10);
}

test.describe('管理画面での問い合わせの対応', () => {
  test('モデレーターがログインの問い合わせへ返信すると、利用者へ通知メールが届き、そのリンクで開いたチャットに返信と管理者のニックネームが出て、添付ファイルをダウンロードできる', async ({
    page,
    clientPage,
  }) => {
    const account = createTestAccount();
    await registerAccount(clientPage, account);
    const firstBody = uniqueText('返信を待つ問い合わせ');
    const attachmentText = uniqueText('添付ファイルの本文');
    const chatPath = await submitMemberInquiry(clientPage, {
      body: firstBody,
      attachment: attachmentText,
    });
    const admin = await signInAsNewAdmin(page, { role: 'moderator' });

    await openInquiryFromList(page, admin, account.nickname);
    await expect(
      attachmentLink(messageItem(adminMessageLog(page), firstBody)),
    ).toBeVisible();
    const replyBody = uniqueText('管理者の返信');
    await replyToInquiry(page, replyBody);
    await expect(messageItem(adminMessageLog(page), replyBody)).toContainText(
      admin.nickname,
    );

    const notification = await waitForEmailWithSubject({
      to: account.email,
      subject: REPLY_NOTIFICATION_SUBJECT,
    });
    expect(notification.text).not.toContain(replyBody);
    const chatLink = notification.links.find(
      (link) => new URL(link).pathname === chatPath,
    );
    if (chatLink === undefined) {
      throw new Error(
        `通知メールに${chatPath}へのリンクがありません: ${notification.links.join(', ')}`,
      );
    }
    await clientPage.goto(chatLink);
    await expect(chatHeading(clientPage)).toBeVisible();
    const reply = messageItem(chatLog(clientPage), replyBody);
    await expect(reply).toHaveCount(1);
    await expect(reply).toContainText(admin.nickname);

    const downloadEvent = clientPage.waitForEvent('download');
    await attachmentLink(messageItem(chatLog(clientPage), firstBody)).click();
    const download = await downloadEvent;
    expect(download.suggestedFilename()).toBe(ATTACHMENT_FILE_NAME);
    expect(await readFile(await download.path(), 'utf8')).toBe(attachmentText);
  });

  test('対応済にしたログインの問い合わせへ利用者が追加メッセージを送ると、対応ステータスが未対応へ戻り、ダッシュボードの未対応の件数が増える', async ({
    page,
    clientPage,
  }) => {
    const account = createTestAccount();
    await registerAccount(clientPage, account);
    await submitMemberInquiry(clientPage, {
      body: uniqueText('対応済にする問い合わせ'),
    });
    const admin = await signInAsNewAdmin(page, { role: 'moderator' });
    const detailPath = await openInquiryFromList(page, admin, account.nickname);
    await changeInquiryStatus(page, 'resolved');
    // 他のテストも問い合わせを送るため、件数は送る前との差で確かめる
    const countBefore = await readUnhandledCount(page);

    const messageForm = clientPage.getByRole('form', {
      name: INQUIRY_MESSAGE_FORM_LABEL,
      exact: true,
    });
    const additionalBody = uniqueText('追加メッセージ');
    await requiredField(messageForm, BODY_LABEL).fill(additionalBody);
    await messageForm
      .getByRole('button', { name: SUBMIT_LABEL, exact: true })
      .click();
    await expect(messageItem(chatLog(clientPage), additionalBody)).toHaveCount(
      1,
    );
    // チャットは管理者が対応済にする前に表示したステータスを持ち続けるため、読み込み直して保存された値を読む
    await clientPage.reload();
    await expect(
      inquiryDetailValue(clientPage, INQUIRY_STATUS_LABEL),
    ).toHaveText(INQUIRY_STATUS_LABELS.open);

    await page.goto(detailPath);
    await expect(inquiryDetailValue(page, STATUS_LABEL)).toHaveText(
      INQUIRY_STATUS_LABELS.open,
    );
    await expect(
      messageItem(adminMessageLog(page), additionalBody),
    ).toHaveCount(1);
    await expect
      .poll(() => readUnhandledCount(page), { timeout: COUNT_POLL_TIMEOUT_MS })
      .toBeGreaterThan(countBefore);
  });

  test('未ログインの問い合わせは一覧に未ログインとして表示され、詳細にニックネーム・連絡先メールアドレス・メッセージとシステム外のメールで回答する旨が出て、返信のフォームは出ない', async ({
    page,
    clientPage,
  }) => {
    const input = createGuestInquiryInput();
    await submitGuestInquiry(await openContactForm(clientPage), input);
    await expectGuestInquiryCompleted(clientPage);
    const admin = await signInAsNewAdmin(page, { role: 'moderator' });

    await openFromAdminNavigation(page, admin, INQUIRIES_PATH);
    await expect(inquiryListRow(page, input.nickname)).toContainText(
      INQUIRY_KIND_LABELS.guest,
    );
    await openInquiryDetailFromList(page, input.nickname);

    for (const [term, value] of [
      [KIND_LABEL, INQUIRY_KIND_LABELS.guest],
      [GUEST_NICKNAME_LABEL, input.nickname],
      [CONTACT_EMAIL_LABEL, input.email],
      [CATEGORY_LABEL, INQUIRY_CATEGORY_OTHER_NAME],
      [STATUS_LABEL, INQUIRY_STATUS_LABELS.open],
      [GUEST_BODY_LABEL, input.body],
    ] as const) {
      await expect(inquiryDetailValue(page, term)).toHaveText(value);
    }
    await expect(page.getByRole('main')).toContainText(GUEST_REPLY_NOTICE);
    await expect(
      page
        .getByRole('main')
        .getByRole('region', { name: REPLY_SECTION_TITLE, exact: true }),
    ).toHaveCount(0);
  });
});
