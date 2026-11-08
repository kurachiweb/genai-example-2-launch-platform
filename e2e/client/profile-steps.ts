import { randomBytes } from 'node:crypto';

import { expect, type Locator, type Page } from '@playwright/test';

import {
  BOLD_ACTION_LABEL,
  FORMAT_TOOLBAR_LABEL,
  LINK_ACTION_LABEL,
  LINK_APPLY_LABEL,
  LINK_DIALOG_TITLE,
  LINK_URL_LABEL,
} from '../../apps/frontend-lib/utilities/messages/markdown-messages.ts';
import {
  IMAGE_CROP_CONFIRM_LABEL,
  IMAGE_CROP_DIALOG_TITLE,
} from '../../apps/frontend-lib/utilities/messages/media-crop-messages.ts';
import { UPLOAD_STATUS_UPLOADED } from '../../apps/frontend-lib/utilities/messages/media-upload-messages.ts';
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
import {
  openProfileSettings,
  registerAccount,
  type TestAccount,
  verifyEmailFromMail,
} from './auth/account-steps.ts';

export { PROFILE_SAVED_MESSAGE } from '../../apps/client/src/components/profile/profile-form-messages.ts';

// 編集領域が選択を状態に取り込むと、その選択の直上に現れる浮動ツールバー。取り込む前にダイアログへフォーカスを移すと、選択が空のままリンクが付かない
const FLOATING_TOOLBAR_SELECTOR = '.milkdown-toolbar[data-show="true"]';

const AVATAR_FILE_NAME = 'e2e-avatar.png';

const AVATAR_SIZE_PX = 64;

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

// 画像の内容は問わないため、ブラウザの描画で単色のPNGを作り、テストのファイルをリポジトリに置かない
async function createAvatarPng(page: Page): Promise<Buffer> {
  const dataUrl = await page.evaluate((size) => {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');
    if (context !== null) {
      context.fillStyle = '#2f6fdb';
      context.fillRect(0, 0, size, size);
    }
    return canvas.toDataURL('image/png');
  }, AVATAR_SIZE_PX);
  return Buffer.from(
    dataUrl.replace(/^data:image\/png;base64,/u, ''),
    'base64',
  );
}

export async function uploadAvatar(page: Page, form: Locator): Promise<void> {
  await form.locator('input[type="file"]').setInputFiles({
    name: AVATAR_FILE_NAME,
    mimeType: 'image/png',
    buffer: await createAvatarPng(page),
  });
  const cropDialog = page.getByRole('dialog', {
    name: IMAGE_CROP_DIALOG_TITLE,
  });
  await cropDialog
    .getByRole('button', { name: IMAGE_CROP_CONFIRM_LABEL, exact: true })
    .click();
  await expect(cropDialog).toHaveCount(0);
  await expect(form.getByText(UPLOAD_STATUS_UPLOADED)).toBeVisible();
}

export interface BioLink {
  readonly text: string;
  readonly url: string;
}

// 入力欄は読み込みの後に編集できるようになり、値はフォーカスが外れた時に確定する。書式のツールが押せるようになってから入力し、次の操作のフォーカスの移動で確定させる。リンクは、段落を分けて入力した文字を行頭まで選んで書式のツールバーの「リンク」のダイアログで設定する。選択の直上に編集領域の浮動ツールバーが現れて書式のツールバーの押下を遮るため、ボタンへ直接クリックを送る。ダイアログの「設定」はリンクを付けるだけで、プロフィールを保存しない
export async function fillBio(
  page: Page,
  form: Locator,
  text: string,
  link: BioLink,
): Promise<void> {
  const editable = form.getByRole('textbox', {
    name: BIO_FIELD_LABEL,
    exact: true,
  });
  const toolbar = form.getByRole('toolbar', { name: FORMAT_TOOLBAR_LABEL });
  await expect(editable).toBeVisible();
  await expect(
    toolbar.getByRole('button', { name: BOLD_ACTION_LABEL, exact: true }),
  ).toBeEnabled();
  await editable.click();
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await page.keyboard.type(link.text);
  await page.keyboard.press('Shift+Home');
  await expect(page.locator(FLOATING_TOOLBAR_SELECTOR)).toBeVisible();
  await toolbar
    .getByRole('button', { name: LINK_ACTION_LABEL, exact: true })
    .dispatchEvent('click');
  const dialog = page.getByRole('dialog', { name: LINK_DIALOG_TITLE });
  const urlField = dialog.getByLabel(LINK_URL_LABEL, { exact: true });
  await expect(urlField).toBeFocused();
  await urlField.fill(link.url);
  await dialog
    .getByRole('button', { name: LINK_APPLY_LABEL, exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(editable.locator('a', { hasText: link.text })).toHaveAttribute(
    'href',
    link.url,
  );
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
