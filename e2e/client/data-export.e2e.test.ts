import { assumeDistinctClientIp } from '../support/client-ip.ts';
import { createTestAccount } from './auth/account-steps.ts';
import { expect, test } from './auth/auth-test.ts';
import {
  clickDownloadAndReadFileName,
  containsEntryName,
  DATA_EXPORT_FLOW_TIMEOUT_MS,
  DATA_EXPORT_PATH,
  expectPendingExport,
  expectReadyExport,
  exportPageLinkOf,
  openDataExportFromSettingsNavigation,
  requestArchive,
  requestDataExport,
  startsWithZipSignature,
  waitForReadyEmail,
} from './data-export-steps.ts';
import {
  createProductInput,
  openProductRegistration,
  registerProduct,
  fillProduct,
  upcomingLaunchDates,
} from './product-steps.ts';
import {
  createProfileInput,
  fillProfile,
  openProfileEditor,
  registerVerifiedAccount,
  saveProfile,
} from './profile-steps.ts';

test.describe.configure({ timeout: DATA_EXPORT_FLOW_TIMEOUT_MS });

const OK_STATUS = 200;

const NOT_FOUND_STATUS = 404;

const escapeRegExp = (text: string): string =>
  text.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);

// 生成にはイベントサーバーのQueueのconsumerを使い、完了のメールはMailpitで確かめるため、@smokeタグを付けない
test.describe('データエクスポート', () => {
  test('プロフィールとプロダクトを用意した利用者の要求が作成中から完了になり、完了のメールのリンクが設定のページを開き、ダウンロードしたZIPが署名と文書の名前を持ち、別の利用者は同じダウンロードのパスで404になる', async ({
    page,
    browser,
    baseURL,
  }) => {
    const account = createTestAccount();
    await registerVerifiedAccount(page, account);
    const profile = createProfileInput();
    const profileForm = await openProfileEditor(page, account);
    await fillProfile(page, profileForm, profile);
    await saveProfile(page, profileForm);

    const product = createProductInput();
    const [launchDate] = upcomingLaunchDates();
    const registrationForm = await openProductRegistration(page);
    await fillProduct(page, registrationForm, product, launchDate);
    await registerProduct(page, registrationForm);

    await openDataExportFromSettingsNavigation(page, account);
    const requestedAt = new Date();
    await requestDataExport(page);
    await expectPendingExport(page);

    const mail = await waitForReadyEmail(account, requestedAt);
    await page.goto(exportPageLinkOf(mail));
    await expect(page).toHaveURL(DATA_EXPORT_PATH);
    const { downloadPath, fileName } = await expectReadyExport(page);
    expect(downloadPath).toMatch(/^\/_bff\/exports\/[^/]+$/u);
    expect(fileName).toMatch(
      new RegExp(
        `^launch-stadium-export-${escapeRegExp(profile.handle)}-\\d{8}\\.zip$`,
        'iu',
      ),
    );

    expect(await clickDownloadAndReadFileName(page)).toBe(fileName);

    const archive = await requestArchive(page, downloadPath);
    expect(archive.status).toBe(OK_STATUS);
    expect(archive.contentType).toBe('application/zip');
    expect(archive.contentDisposition).toMatch(/^attachment;/u);
    expect(archive.contentDisposition).toContain(`filename="${fileName}"`);
    expect(startsWithZipSignature(archive.body)).toBe(true);
    expect(containsEntryName(archive.body, 'manifest.json')).toBe(true);
    expect(containsEntryName(archive.body, 'products.json')).toBe(true);
    expect(containsEntryName(archive.body, 'profile/bio.md')).toBe(true);
    expect(
      containsEntryName(
        archive.body,
        `products/${product.handle}/description.md`,
      ),
    ).toBe(true);

    const otherContext = await browser.newContext({ baseURL });
    try {
      await assumeDistinctClientIp(otherContext, baseURL);
      const otherPage = await otherContext.newPage();
      await registerVerifiedAccount(otherPage, createTestAccount());
      const otherResponse = await requestArchive(otherPage, downloadPath);
      expect(otherResponse.status).toBe(NOT_FOUND_STATUS);
    } finally {
      await otherContext.close();
    }
  });
});
