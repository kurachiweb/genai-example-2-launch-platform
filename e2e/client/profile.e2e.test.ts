import type { Locator, Page } from '@playwright/test';

import {
  avatarLabelOf,
  PROFILE_WEBSITES_LABEL,
} from '../../apps/client/src/components/profile/profile-messages.ts';
import { PROFILE_FORM_MESSAGES } from '../../apps/client/src/components/profile/profile-form-messages.ts';
import {
  REACTION_TIMEOUT_MS,
  RETRY_TIMEOUT_MS,
} from '../support/hydration-retry.ts';
import { assumeDistinctClientIp } from '../support/client-ip.ts';
import {
  createTestAccount,
  MAIL_FLOW_TIMEOUT_MS,
} from './auth/account-steps.ts';
import { expect, test } from './auth/auth-test.ts';
import {
  createProfileHandle,
  createProfileInput,
  fillHandle,
  fillProfile,
  openProfileEditor,
  openPublicProfile,
  profilePath,
  readCurrentHandle,
  registerVerifiedAccount,
  saveButton,
  saveProfile,
} from './profile-steps.ts';

test.describe.configure({ timeout: MAIL_FLOW_TIMEOUT_MS });

const RESERVED_HANDLE = 'admin';

const REDIRECT_STATUS = 302;

const PLACEHOLDER_SELECTOR = '[data-slot="media-placeholder"]';

const pathOf = (url: string, baseURL: string | undefined): string => {
  const { pathname } = new URL(url, baseURL);
  return decodeURIComponent(pathname);
};

// 転送を追わない要求で、サーバーが返す状態と転送先を確かめる
async function requestWithoutFollowing(
  page: Page,
  handle: string,
): Promise<{ status: number; location: string | undefined }> {
  const response = await page.request.get(profilePath(handle), {
    maxRedirects: 0,
  });
  return {
    status: response.status(),
    location: response.headers().location,
  };
}

// 画像が無い時のプレースホルダーも同じ名前のimgの役割を持つため、実際の画像の要素が読み込まれ、プレースホルダーが無いことで確かめる。変換配信が間に合わない間はプレースホルダーになるため、読み込み直して待つ
async function expectUploadedAvatar(
  page: Page,
  nickname: string,
): Promise<void> {
  const avatar = page.locator(`img[alt="${avatarLabelOf(nickname)}"]`);
  await expect(async () => {
    try {
      await expect(page.locator(PLACEHOLDER_SELECTOR)).toHaveCount(0, {
        timeout: REACTION_TIMEOUT_MS,
      });
      await expect(avatar).toBeVisible({ timeout: REACTION_TIMEOUT_MS });
      await expect(avatar).toHaveAttribute('src', /\S/u, {
        timeout: REACTION_TIMEOUT_MS,
      });
      expect(
        await avatar.evaluate((image: HTMLImageElement) => image.naturalWidth),
      ).toBeGreaterThan(0);
    } catch (error) {
      await page.reload();
      throw error;
    }
  }).toPass({ timeout: RETRY_TIMEOUT_MS });
}

const canonicalLink = (page: Page): Locator =>
  page.locator('link[rel="canonical"]');

test.describe('プロフィールの編集と公開', () => {
  test('編集した内容が新しいハンドルの公開プロフィールに出て、大文字の表記でも表示され、初期ハンドルのURLは新しいURLへ転送される', async ({
    page,
    baseURL,
  }) => {
    const account = createTestAccount();
    await registerVerifiedAccount(page, account);
    const form = await openProfileEditor(page, account);
    const initialHandle = await readCurrentHandle(form);
    const input = createProfileInput();

    await fillProfile(page, form, input);
    await saveProfile(page, form);

    await openPublicProfile(page, input.handle);
    await expect(
      page.getByRole('heading', { level: 1, name: account.nickname }),
    ).toBeVisible();
    await expect(
      page.getByText(`@${input.handle}`, { exact: true }),
    ).toBeVisible();
    await expect(page.getByText(input.headline, { exact: true })).toBeVisible();
    await expectUploadedAvatar(page, account.nickname);
    const bioLink = page.getByRole('link', { name: input.bioLinkText });
    await expect(bioLink).toHaveAttribute('href', input.bioLinkUrl);
    await expect(bioLink).toHaveAttribute('rel', /\bugc\b/u);
    const websiteLink = page
      .getByRole('list', { name: PROFILE_WEBSITES_LABEL })
      .getByRole('link', { name: new RegExp(input.websiteName, 'u') });
    await expect(websiteLink).toHaveAttribute('href', input.websiteUrl);
    await expect(websiteLink).toHaveAttribute('rel', /\bugc\b/u);
    await expect(websiteLink).toHaveAttribute('rel', /\bnoopener\b/u);

    const uppercaseHandle = input.handle.toUpperCase();
    const uppercaseResponse = await page.goto(profilePath(uppercaseHandle));
    expect(uppercaseResponse?.status()).toBe(200);
    await expect(page).toHaveURL(
      (url) => pathOf(url.href, baseURL) === profilePath(uppercaseHandle),
    );
    await expect(
      page.getByRole('heading', { level: 1, name: account.nickname }),
    ).toBeVisible();
    await expect(canonicalLink(page)).toHaveAttribute(
      'href',
      new RegExp(`${profilePath(input.handle)}$`, 'u'),
    );

    const redirect = await requestWithoutFollowing(page, initialHandle);
    expect(redirect.status).toBe(REDIRECT_STATUS);
    expect(pathOf(redirect.location ?? '', baseURL)).toBe(
      profilePath(input.handle),
    );
    await page.goto(profilePath(initialHandle));
    await expect(page).toHaveURL(
      (url) => pathOf(url.href, baseURL) === profilePath(input.handle),
    );
  });

  test('予約語のハンドルは保存を拒否され、既に使われている場合と同じ文言が出る', async ({
    page,
  }) => {
    const account = createTestAccount();
    await registerVerifiedAccount(page, account);
    const form = await openProfileEditor(page, account);

    await fillHandle(form, RESERVED_HANDLE);
    await saveButton(form).click();

    await expect(
      form.getByText(PROFILE_FORM_MESSAGES.handleUnavailable),
    ).toBeVisible();
  });

  test('別の利用者が最初の利用者の旧ハンドルを設定でき、その後は旧ハンドルのURLが転送されず設定した利用者の公開プロフィールを表示する', async ({
    page,
    browser,
    baseURL,
  }) => {
    const first = createTestAccount();
    await registerVerifiedAccount(page, first);
    const firstForm = await openProfileEditor(page, first);
    const initialHandle = await readCurrentHandle(firstForm);
    const firstHandle = createProfileHandle();
    await fillHandle(firstForm, firstHandle);
    await saveProfile(page, firstForm);
    const beforeTakeover = await requestWithoutFollowing(page, initialHandle);
    expect(beforeTakeover.status).toBe(REDIRECT_STATUS);

    const secondContext = await browser.newContext({ baseURL });
    try {
      await assumeDistinctClientIp(secondContext, baseURL);
      const secondPage = await secondContext.newPage();
      const second = createTestAccount();
      await registerVerifiedAccount(secondPage, second);
      const secondForm = await openProfileEditor(secondPage, second);
      await fillHandle(secondForm, initialHandle);
      await saveProfile(secondPage, secondForm);

      const afterTakeover = await requestWithoutFollowing(page, initialHandle);
      expect(afterTakeover.status).toBe(200);
      await openPublicProfile(page, initialHandle);
      await expect(page).toHaveURL(
        (url) => pathOf(url.href, baseURL) === profilePath(initialHandle),
      );
      await expect(
        page.getByRole('heading', { level: 1, name: second.nickname }),
      ).toBeVisible();
      await expect(
        page.getByRole('heading', { level: 1, name: first.nickname }),
      ).toHaveCount(0);
    } finally {
      await secondContext.close();
    }
  });
});
