import { randomBytes } from 'node:crypto';

import type { Locator, Page } from '@playwright/test';

import { REQUIRED_SUFFIX } from '../../../apps/client/src/components/auth/account-messages.ts';
import { ATTACHED_FILES_LABEL } from '../../../apps/client/src/components/inquiry/inquiry-attachment-messages.ts';
import {
  INQUIRY_CHAT_PAGE_TITLE,
  INQUIRY_MESSAGE_FORM_LABEL,
  INQUIRY_STATUS_LABEL,
  SUSPENDED_CHAT_NOTICE_LINK,
} from '../../../apps/client/src/components/inquiry/inquiry-chat-messages.ts';
import {
  BODY_LABEL,
  CATEGORY_LABEL,
  CONTACT_EMAIL_LABEL,
  CONTACT_FORM_LABEL,
  GUEST_COMPLETE_TITLE,
  NICKNAME_LABEL,
  SUBMIT_LABEL,
  SUSPENDED_CONTACT_NOTICE_LABEL,
} from '../../../apps/client/src/components/inquiry/inquiry-contact-messages.ts';
import { CONTACT_HREF } from '../../../apps/client/src/components/layout/site-links.ts';
import { INQUIRY_CATEGORY_OTHER_NAME } from '../../../apps/common-lib/inquiry/inquiry-category-constants.ts';
import { INQUIRY_STATUS_LABELS } from '../../../apps/common-lib/inquiry/inquiry-status.ts';
import { INQUIRY_ATTACHMENTS_LABEL } from '../../../apps/frontend-lib/utilities/messages/inquiry-display-messages.ts';
import { executeLocalD1, sqlStringLiteral } from '../../support/local-d1.ts';
import { TEST_EMAIL_DOMAIN } from '../../support/test-email.ts';
import {
  createTestAccount,
  registerAccount,
  type TestAccount,
  waitForBotToken,
} from '../auth/account-steps.ts';
import { expect, test } from '../auth/auth-test.ts';

const CHAT_PATH_PATTERN = /\/inquiries\/[0-9A-HJKMNP-TV-Z]{26}$/u;

const ATTACHMENT_FILE_NAME = 'e2e-inquiry-attachment.txt';

// 登録・ファイルのアップロード・停止の用意と複数のページの描画を1つの流れで待つため、既定の30秒では開発サーバーの負荷で足りなくなることがある
const INQUIRY_FLOW_TIMEOUT_MS = 90_000;

// 前回の実行の問い合わせと区別でき、保存された行を本文で探せるよう、実行ごとに乱数を含める
const uniqueText = (label: string): string =>
  `E2E${label}${randomBytes(6).toString('hex')}`;

const contactForm = (page: Page): Locator =>
  page.getByRole('form', { name: CONTACT_FORM_LABEL, exact: true });

const requiredField = (form: Locator, label: string): Locator =>
  form.getByLabel(`${label}${REQUIRED_SUFFIX}`, { exact: true });

// 選択のボタンは欄のラベルを名前にするため、添付の入力欄の有無はファイルの入力要素で確かめる
const attachmentFileInput = (form: Locator): Locator =>
  form.locator('input[type="file"]');

const chatHeading = (page: Page): Locator =>
  page.getByRole('heading', {
    level: 1,
    name: INQUIRY_CHAT_PAGE_TITLE,
    exact: true,
  });

const chatLog = (page: Page): Locator =>
  page.getByRole('main').getByRole('log');

interface GuestInquiryInput {
  readonly nickname: string;
  readonly email: string;
  readonly body: string;
}

const createGuestInquiryInput = (): GuestInquiryInput => {
  const suffix = randomBytes(6).toString('hex');
  return {
    nickname: `E2E送信者${suffix.slice(0, 6)}`,
    email: `e2e-inquiry-${suffix}@${TEST_EMAIL_DOMAIN}`,
    body: uniqueText('未ログインの問い合わせ'),
  };
};

async function openContactForm(page: Page): Promise<Locator> {
  await page.goto(CONTACT_HREF);
  const form = contactForm(page);
  await waitForBotToken(form);
  return form;
}

// 未ログインの問い合わせのフォームには添付ファイルの入力欄が無く、ニックネームと連絡先の入力欄がある
async function submitGuestInquiry(
  form: Locator,
  input: GuestInquiryInput,
): Promise<void> {
  await expect(attachmentFileInput(form)).toHaveCount(0);
  await requiredField(form, CATEGORY_LABEL).selectOption({
    label: INQUIRY_CATEGORY_OTHER_NAME,
  });
  await requiredField(form, NICKNAME_LABEL).fill(input.nickname);
  await requiredField(form, CONTACT_EMAIL_LABEL).fill(input.email);
  await requiredField(form, BODY_LABEL).fill(input.body);
  await form.getByRole('button', { name: SUBMIT_LABEL, exact: true }).click();
}

async function expectGuestInquiryCompleted(page: Page): Promise<void> {
  await expect(
    page.getByRole('heading', {
      level: 2,
      name: GUEST_COMPLETE_TITLE,
      exact: true,
    }),
  ).toBeFocused();
  await expect(contactForm(page)).toHaveCount(0);
}

// 未ログインの問い合わせを管理画面で見る流れは別のテストで確かめるため、ここでは未ログインの問い合わせとして「未対応」で保存されたことを保存先で確かめる
async function expectSavedGuestInquiry(
  input: GuestInquiryInput,
): Promise<void> {
  const rows = await executeLocalD1(
    `SELECT nickname, status FROM guest_inquiries WHERE email = ${sqlStringLiteral(input.email)} AND body = ${sqlStringLiteral(input.body)};`,
  );
  expect(rows).toEqual([{ nickname: input.nickname, status: 'open' }]);
}

interface MemberInquiryInput {
  readonly body: string;
  readonly attachment?: string;
}

async function submitMemberInquiry(
  page: Page,
  input: MemberInquiryInput,
): Promise<string> {
  const form = await openContactForm(page);
  await expect(requiredField(form, NICKNAME_LABEL)).toHaveCount(0);
  await expect(requiredField(form, CONTACT_EMAIL_LABEL)).toHaveCount(0);
  await expect(attachmentFileInput(form)).toHaveCount(1);
  await requiredField(form, CATEGORY_LABEL).selectOption({
    label: INQUIRY_CATEGORY_OTHER_NAME,
  });
  await requiredField(form, BODY_LABEL).fill(input.body);
  if (input.attachment !== undefined) {
    await attachmentFileInput(form).setInputFiles({
      name: ATTACHMENT_FILE_NAME,
      mimeType: 'text/plain',
      buffer: Buffer.from(input.attachment, 'utf8'),
    });
    await expect(
      form
        .getByRole('list', { name: ATTACHED_FILES_LABEL, exact: true })
        .getByText(ATTACHMENT_FILE_NAME, { exact: true }),
    ).toBeVisible();
  }
  await form.getByRole('button', { name: SUBMIT_LABEL, exact: true }).click();
  await expect(page).toHaveURL(CHAT_PATH_PATTERN);
  await expect(chatHeading(page)).toBeVisible();
  return new URL(page.url()).pathname;
}

async function expectFirstMessage(
  page: Page,
  account: TestAccount,
  body: string,
): Promise<void> {
  const main = page.getByRole('main');
  await expect(
    main.getByRole('term').filter({ hasText: INQUIRY_STATUS_LABEL }),
  ).toBeVisible();
  for (const value of [
    INQUIRY_CATEGORY_OTHER_NAME,
    INQUIRY_STATUS_LABELS.open,
  ]) {
    await expect(
      main.getByRole('definition').filter({ hasText: value }),
    ).toBeVisible();
  }
  const message = chatLog(page).getByRole('listitem').filter({ hasText: body });
  await expect(message).toHaveCount(1);
  await expect(message).toContainText(account.nickname);
}

// 画面で停止させる手段は管理者側の機能のため、ローカルのD1で利用者を停止中にする。状態は要求ごとに保存済みの値から読まれるため、次の要求から反映される
async function suspendUser(account: TestAccount): Promise<void> {
  const suspended = await executeLocalD1(
    `UPDATE users SET status = ${sqlStringLiteral('suspended')}, suspended_at = ${String(Date.now())} WHERE email = ${sqlStringLiteral(account.email)} AND deleted_at IS NULL RETURNING id;`,
  );
  if (suspended.length !== 1) {
    throw new Error(
      `ローカルのD1で利用者${account.email}を停止中にできませんでした`,
    );
  }
}

test.describe('問い合わせの送信(利用者側)', () => {
  test('ログインしていない利用者が送信すると、フォームが送信完了の表示に置き換わり、未対応の未ログインの問い合わせとして保存される', async ({
    page,
  }) => {
    test.setTimeout(INQUIRY_FLOW_TIMEOUT_MS);
    const input = createGuestInquiryInput();

    const form = await openContactForm(page);
    await submitGuestInquiry(form, input);

    await expectGuestInquiryCompleted(page);
    await expectSavedGuestInquiry(input);
  });

  test('ログイン中の利用者がファイルを添付して送信すると、その問い合わせのチャットへ移り、最初のメッセージと添付が表示される', async ({
    page,
  }) => {
    test.setTimeout(INQUIRY_FLOW_TIMEOUT_MS);
    const account = createTestAccount();
    await registerAccount(page, account);
    const body = uniqueText('添付付きの問い合わせ');

    await submitMemberInquiry(page, {
      body,
      attachment: uniqueText('添付ファイルの本文'),
    });

    await expectFirstMessage(page, account, body);
    await expect(
      chatLog(page)
        .getByRole('listitem')
        .filter({ hasText: body })
        .getByRole('list', { name: INQUIRY_ATTACHMENTS_LABEL, exact: true })
        .getByRole('link', { name: ATTACHMENT_FILE_NAME }),
    ).toBeVisible();
    await expect(
      page.getByRole('form', { name: INQUIRY_MESSAGE_FORM_LABEL, exact: true }),
    ).toBeVisible();
  });

  test('停止中の利用者は、既存のチャットで送信欄の代わりに案内が出て、お問い合わせのページでは連絡先を入力するフォームから未ログインの問い合わせとして送信できる', async ({
    page,
  }) => {
    test.setTimeout(INQUIRY_FLOW_TIMEOUT_MS);
    const account = createTestAccount();
    await registerAccount(page, account);
    const body = uniqueText('停止の前の問い合わせ');
    const chatPath = await submitMemberInquiry(page, { body });

    await suspendUser(account);

    await page.goto(chatPath);
    await expect(chatHeading(page)).toBeVisible();
    await expectFirstMessage(page, account, body);
    const chatNotice = page
      .getByRole('main')
      .getByRole('note', { name: SUSPENDED_CONTACT_NOTICE_LABEL, exact: true });
    await expect(
      chatNotice.getByRole('link', {
        name: SUSPENDED_CHAT_NOTICE_LINK,
        exact: true,
      }),
    ).toHaveAttribute('href', CONTACT_HREF);
    await expect(
      page.getByRole('form', { name: INQUIRY_MESSAGE_FORM_LABEL, exact: true }),
    ).toHaveCount(0);

    const form = await openContactForm(page);
    await expect(
      page.getByRole('main').getByRole('note', {
        name: SUSPENDED_CONTACT_NOTICE_LABEL,
        exact: true,
      }),
    ).toBeVisible();
    const input = {
      ...createGuestInquiryInput(),
      body: uniqueText('停止中の問い合わせ'),
    };
    await submitGuestInquiry(form, input);

    await expectGuestInquiryCompleted(page);
    await expectSavedGuestInquiry(input);
  });
});
