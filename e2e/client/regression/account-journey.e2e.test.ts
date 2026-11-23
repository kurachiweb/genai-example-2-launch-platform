import { HOME_HREF } from '../../../apps/client/src/components/layout/site-links.ts';
import {
  LEGAL_DOCUMENT_KINDS,
  LEGAL_DOCUMENT_LABELS,
  LEGAL_DOCUMENT_PATHS,
} from '../../../apps/common-lib/legal/legal-documents.ts';
import { HELP_CATEGORIES_TITLE } from '../../../apps/admin/src/components/help/help-messages.ts';
import { CATEGORIES_PATH, createCategory } from '../../admin/category-steps.ts';
import {
  HELP_INDEX_TIMEOUT_MS,
  helpArticleHref,
  waitForHelpSearchResult,
  createHelpSearchToken,
} from '../../admin/help-center-steps.ts';
import {
  ADMIN_FLOW_TIMEOUT_MS,
  openFromAdminNavigation,
  signInAsNewAdmin,
} from '../../support/admin-bootstrap.ts';
import {
  MAIL_FLOW_TIMEOUT_MS,
  createTestAccount,
} from '../auth/account-steps.ts';
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
} from '../data-export-steps.ts';
import { registerVerifiedAccount } from '../profile-steps.ts';
import { uniqueText } from '../inquiry/inquiry-steps.ts';
import {
  createJourneyArticleInput,
  documentHeading,
  expectFooterRelativeOrder,
  expectHelpTopOrder,
  expectLoadedLegalDocument,
  expectLoggedOutAfterWithdrawal,
  expectLoginRejected,
  expectPinnedOrderInAdmin,
  footerPolicyNavigation,
  movePinnedArticleUp,
  publishJourneyArticle,
  withdrawAccount,
} from './account-journey-steps.ts';
import { expect, test } from './account-journey-test.ts';

const OK_STATUS = 200;

// 管理者の招待の完了に加え、カテゴリと記事2件の作成、並べ替え、索引の更新の待ち、利用者側の確認、終わりの後片付けの分を足す
const HELP_FLOW_TIMEOUT_MS =
  ADMIN_FLOW_TIMEOUT_MS + HELP_INDEX_TIMEOUT_MS + 360_000;

// カテゴリと記事は実行ごとの専用の名前で作り、終わりに削除する。ローカルのメール受信箱とD1を使うため、@smokeタグを付けない
test.describe('ヘルプ・法務文書・データエクスポート・退会の流れ', () => {
  test('モデレーターが専用のカテゴリへピン留めの公開記事を2件作り、ピン留めの群の中で入れ替えると、利用者側のヘルプトップとフッターで2件の相対的な順が入れ替わり、利用者側の検索で記事に到達できる', async ({
    page,
    helpRecord,
  }) => {
    test.setTimeout(HELP_FLOW_TIMEOUT_MS);
    const adminPage = helpRecord.adminPage;
    const categoryName = uniqueText('回帰のヘルプ');
    const searchToken = createHelpSearchToken();
    const first = createJourneyArticleInput(
      'A',
      categoryName,
      `検索で確かめる語 ${searchToken} を含む本文です。`,
    );
    const second = createJourneyArticleInput(
      'B',
      categoryName,
      '入れ替えを確かめる記事の本文です。',
    );

    const moderator = await signInAsNewAdmin(adminPage, { role: 'moderator' });
    helpRecord.categoryName = categoryName;
    await openFromAdminNavigation(adminPage, moderator, CATEGORIES_PATH);
    await createCategory(adminPage, HELP_CATEGORIES_TITLE, {
      name: categoryName,
    });
    await publishJourneyArticle(helpRecord, first);
    await publishJourneyArticle(helpRecord, second);

    await expectPinnedOrderInAdmin(adminPage, categoryName, [
      first.title,
      second.title,
    ]);
    await expectHelpTopOrder(page, categoryName, [first.title, second.title]);
    await expectFooterRelativeOrder(page, [first.handle, second.handle]);

    const results = await waitForHelpSearchResult(
      page,
      searchToken,
      first.title,
    );
    await results.getByRole('link').filter({ hasText: first.title }).click();
    await expect(page).toHaveURL(
      (url) => url.pathname === helpArticleHref(first.handle),
    );
    await expect(
      page
        .getByRole('main')
        .getByRole('heading', { level: 1, name: first.title }),
    ).toBeVisible();

    await movePinnedArticleUp(adminPage, categoryName, second.title);
    await expectPinnedOrderInAdmin(adminPage, categoryName, [
      second.title,
      first.title,
    ]);
    await expectHelpTopOrder(page, categoryName, [second.title, first.title]);
    await expectFooterRelativeOrder(page, [second.handle, first.handle]);
  });

  for (const kind of LEGAL_DOCUMENT_KINDS) {
    const label = LEGAL_DOCUMENT_LABELS[kind];
    const path = LEGAL_DOCUMENT_PATHS[kind];

    test(`トップページのフッターの${label}のリンクから${path}を開くと、見出しが${label}で、最終改訂日か準備中の表示が出る`, async ({
      page,
    }) => {
      await page.goto(HOME_HREF);

      await footerPolicyNavigation(page)
        .getByRole('link', { name: label, exact: true })
        .click();

      await expect(page).toHaveURL((url) => url.pathname === path);
      await expect(documentHeading(page, label)).toBeVisible();
      await expectLoadedLegalDocument(page);
      const direct = await page.request.get(path);
      expect(direct.status()).toBe(OK_STATUS);
    });
  }

  test('確認済みの利用者がデータエクスポートを要求すると、完了のメールのリンクからZIPをダウンロードでき、退会するとログアウトされ、同じメールアドレスとパスワードではログインできない', async ({
    page,
  }) => {
    test.setTimeout(DATA_EXPORT_FLOW_TIMEOUT_MS + MAIL_FLOW_TIMEOUT_MS);
    const account = createTestAccount();
    await registerVerifiedAccount(page, account);

    await openDataExportFromSettingsNavigation(page, account);
    const requestedAt = new Date();
    await requestDataExport(page);
    await expectPendingExport(page);

    const mail = await waitForReadyEmail(account, requestedAt);
    await page.goto(exportPageLinkOf(mail));
    await expect(page).toHaveURL(DATA_EXPORT_PATH);
    const { downloadPath, fileName } = await expectReadyExport(page);
    expect(await clickDownloadAndReadFileName(page)).toBe(fileName);
    const archive = await requestArchive(page, downloadPath);
    expect(archive.status).toBe(OK_STATUS);
    expect(archive.contentType).toBe('application/zip');
    expect(startsWithZipSignature(archive.body)).toBe(true);
    expect(containsEntryName(archive.body, 'manifest.json')).toBe(true);

    await withdrawAccount(page, account);
    await expectLoggedOutAfterWithdrawal(page, account);
    await expectLoginRejected(page, account);
  });
});
