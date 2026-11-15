import { randomBytes } from 'node:crypto';

import { expect, type Locator, type Page } from '@playwright/test';

import { REQUIRED_SUFFIX } from '../../../apps/client/src/components/auth/account-messages.ts';
import { ATTACHED_FILES_LABEL } from '../../../apps/client/src/components/inquiry/inquiry-attachment-messages.ts';
import { INQUIRY_CHAT_PAGE_TITLE } from '../../../apps/client/src/components/inquiry/inquiry-chat-messages.ts';
import {
  BODY_LABEL,
  CATEGORY_LABEL,
  CONTACT_EMAIL_LABEL,
  CONTACT_FORM_LABEL,
  GUEST_COMPLETE_TITLE,
  NICKNAME_LABEL,
  SUBMIT_LABEL,
} from '../../../apps/client/src/components/inquiry/inquiry-contact-messages.ts';
import { CONTACT_HREF } from '../../../apps/client/src/components/layout/site-links.ts';
import { INQUIRY_CATEGORY_OTHER_NAME } from '../../../apps/common-lib/inquiry/inquiry-category-constants.ts';
import { waitForBotToken } from '../../support/bot-verification.ts';
import { TEST_EMAIL_DOMAIN } from '../../support/test-email.ts';

const CHAT_PATH_PATTERN = /\/inquiries\/[0-9A-HJKMNP-TV-Z]{26}$/u;

export const ATTACHMENT_FILE_NAME = 'e2e-inquiry-attachment.txt';

// 登録・ファイルのアップロード・停止の用意と複数のページの描画を1つの流れで待つため、既定の30秒では開発サーバーの負荷で足りなくなることがある
export const INQUIRY_FLOW_TIMEOUT_MS = 90_000;

// 前回の実行の問い合わせと区別でき、保存された行を本文で探せるよう、実行ごとに乱数を含める
export const uniqueText = (label: string): string =>
  `E2E${label}${randomBytes(6).toString('hex')}`;

const contactForm = (page: Page): Locator =>
  page.getByRole('form', { name: CONTACT_FORM_LABEL, exact: true });

export const requiredField = (form: Locator, label: string): Locator =>
  form.getByLabel(`${label}${REQUIRED_SUFFIX}`, { exact: true });

// 選択のボタンは欄のラベルを名前にするため、添付の入力欄の有無はファイルの入力要素で確かめる
export const attachmentFileInput = (form: Locator): Locator =>
  form.locator('input[type="file"]');

export const chatHeading = (page: Page): Locator =>
  page.getByRole('heading', {
    level: 1,
    name: INQUIRY_CHAT_PAGE_TITLE,
    exact: true,
  });

export const chatLog = (page: Page): Locator =>
  page.getByRole('main').getByRole('log');

export interface GuestInquiryInput {
  readonly nickname: string;
  readonly email: string;
  readonly body: string;
  // 未指定なら標準カテゴリを選ぶ
  readonly categoryName?: string;
}

export const createGuestInquiryInput = (): GuestInquiryInput => {
  const suffix = randomBytes(6).toString('hex');
  return {
    nickname: `E2E送信者${suffix.slice(0, 6)}`,
    email: `e2e-inquiry-${suffix}@${TEST_EMAIL_DOMAIN}`,
    body: uniqueText('未ログインの問い合わせ'),
  };
};

export async function openContactForm(page: Page): Promise<Locator> {
  await page.goto(CONTACT_HREF);
  const form = contactForm(page);
  await waitForBotToken(form);
  return form;
}

// 未ログインの問い合わせのフォームには添付ファイルの入力欄が無く、ニックネームと連絡先の入力欄がある
export async function submitGuestInquiry(
  form: Locator,
  input: GuestInquiryInput,
): Promise<void> {
  await expect(attachmentFileInput(form)).toHaveCount(0);
  await requiredField(form, CATEGORY_LABEL).selectOption({
    label: input.categoryName ?? INQUIRY_CATEGORY_OTHER_NAME,
  });
  await requiredField(form, NICKNAME_LABEL).fill(input.nickname);
  await requiredField(form, CONTACT_EMAIL_LABEL).fill(input.email);
  await requiredField(form, BODY_LABEL).fill(input.body);
  await form.getByRole('button', { name: SUBMIT_LABEL, exact: true }).click();
}

export async function expectGuestInquiryCompleted(page: Page): Promise<void> {
  await expect(
    page.getByRole('heading', {
      level: 2,
      name: GUEST_COMPLETE_TITLE,
      exact: true,
    }),
  ).toBeFocused();
  await expect(contactForm(page)).toHaveCount(0);
}

export interface MemberInquiryInput {
  readonly body: string;
  readonly attachment?: string;
}

// 送信後に移ったチャットのパスを返す
export async function submitMemberInquiry(
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
