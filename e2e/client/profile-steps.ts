import { randomBytes } from 'node:crypto';

import { expect, type Locator, type Page } from '@playwright/test';

import {
  BIO_FIELD_LABEL,
  HANDLE_FIELD_LABEL,
  HEADLINE_FIELD_LABEL,
  PROFILE_FORM_LABEL,
  PROFILE_SAVE_LABEL,
  PROFILE_SAVED_MESSAGE,
  WEBSITE_ADD_LABEL,
  WEBSITE_NAME_LABEL,
  WEBSITE_URL_LABEL,
  websiteRowLabelOf,
} from '../../apps/client/src/components/profile/profile-form-messages.ts';
import { waitForBotToken } from '../support/bot-verification.ts';
import { uploadCroppedImage } from '../support/image-upload.ts';
import {
  openProfileSettings,
  registerAccount,
  type TestAccount,
  verifyEmailFromMail,
} from './auth/account-steps.ts';
import { fillMarkdownWithLink, type MarkdownLink } from './markdown-steps.ts';

export { PROFILE_SAVED_MESSAGE } from '../../apps/client/src/components/profile/profile-form-messages.ts';

const AVATAR_FILE_NAME = 'e2e-avatar.png';

export interface ProfileInput {
  readonly handle: string;
  readonly headline: string;
  readonly bioText: string;
  readonly bioLinkText: string;
  readonly bioLinkUrl: string;
  readonly websiteName: string;
  readonly websiteUrl: string;
}

// 前の実行のデータと衝突せず、予約語や初期ハンドルの形式(英小文字と数字の12文字)にも当たらないよう、大文字を含む表記を乱数から作る
export function createProfileHandle(): string {
  return `E2eHandle${randomBytes(4).toString('hex')}`;
}

export function createProfileInput(): ProfileInput {
  const suffix = randomBytes(4).toString('hex');
  return {
    handle: createProfileHandle(),
    headline: `E2Eのヘッドライン${suffix}`,
    bioText: `E2Eの自己紹介${suffix}です。`,
    bioLinkText: `E2Eの自己紹介のリンク${suffix}`,
    bioLinkUrl: `https://bio-${suffix}.example/profile`,
    websiteName: `E2Eの外部Webサイト${suffix}`,
    websiteUrl: `https://site-${suffix}.example/`,
  };
}

// 確認のメールを受け取るまでを含め、メールアドレスの確認が済んだ利用者として登録する
export async function registerVerifiedAccount(
  page: Page,
  account: TestAccount,
): Promise<void> {
  await registerAccount(page, account);
  await verifyEmailFromMail(page, account);
}

export const profileForm = (page: Page): Locator =>
  page.getByRole('form', { name: PROFILE_FORM_LABEL });

const handleField = (form: Locator): Locator =>
  form.getByLabel(HANDLE_FIELD_LABEL, { exact: true });

// 設定ページのフォームの入力はハイドレーションの後でなければ状態に入らないため、ハイドレーション済みの画面からルーターの遷移で開き、bot判定のトークンが入るのを待つ
export async function openProfileEditor(
  page: Page,
  account: TestAccount,
): Promise<Locator> {
  await openProfileSettings(page, account);
  const form = profileForm(page);
  await expect(form).toBeVisible();
  await waitForBotToken(form);
  return form;
}

export async function readCurrentHandle(form: Locator): Promise<string> {
  const field = handleField(form);
  await expect(field).not.toHaveValue('');
  return field.inputValue();
}

export async function fillHandle(form: Locator, handle: string): Promise<void> {
  await handleField(form).fill(handle);
}

export const saveButton = (form: Locator): Locator =>
  form.getByRole('button', { name: PROFILE_SAVE_LABEL, exact: true });

export async function saveProfile(page: Page, form: Locator): Promise<void> {
  await saveButton(form).click();
  await expect(page.getByText(PROFILE_SAVED_MESSAGE)).toBeVisible();
}

export async function uploadAvatar(page: Page, form: Locator): Promise<void> {
  await uploadCroppedImage(page, form, { fileName: AVATAR_FILE_NAME });
}

// ダイアログの「設定」はリンクを付けるだけで、プロフィールを保存しない
export async function fillBio(
  page: Page,
  form: Locator,
  text: string,
  link: MarkdownLink,
): Promise<void> {
  await fillMarkdownWithLink(page, form, BIO_FIELD_LABEL, text, link);
  await expect(page.getByText(PROFILE_SAVED_MESSAGE)).toHaveCount(0);
}

export async function addWebsite(
  form: Locator,
  position: number,
  name: string,
  url: string,
): Promise<void> {
  await form.getByRole('button', { name: WEBSITE_ADD_LABEL }).click();
  const row = form.getByRole('group', { name: websiteRowLabelOf(position) });
  await row.getByLabel(WEBSITE_NAME_LABEL, { exact: true }).fill(name);
  await row.getByLabel(WEBSITE_URL_LABEL, { exact: true }).fill(url);
}

export async function fillProfile(
  page: Page,
  form: Locator,
  input: ProfileInput,
): Promise<void> {
  await uploadAvatar(page, form);
  await fillHandle(form, input.handle);
  await form
    .getByLabel(HEADLINE_FIELD_LABEL, { exact: true })
    .fill(input.headline);
  await addWebsite(form, 1, input.websiteName, input.websiteUrl);
  await fillBio(page, form, input.bioText, {
    text: input.bioLinkText,
    url: input.bioLinkUrl,
  });
}

export const profilePath = (handle: string): string => `/@${handle}`;

export async function openPublicProfile(
  page: Page,
  handle: string,
): Promise<void> {
  await page.goto(profilePath(handle));
}
