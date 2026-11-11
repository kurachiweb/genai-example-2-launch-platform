import type { Locator, Page } from '@playwright/test';

import {
  AUDIT_LOG_LIST_CAPTION,
  AUDIT_LOGS_TITLE,
} from '../../apps/admin/src/components/audit/audit-logs-messages.ts';
import {
  HELP_ARTICLE_CREATE_LABEL,
  HELP_ARTICLE_LIST_CAPTION,
  HELP_ARTICLE_ORDER_EDIT_LABEL,
  HELP_ARTICLE_ORDER_VIEW_LABEL,
  HELP_ARTICLES_TITLE,
  HELP_CATEGORIES_TITLE,
  HELP_CATEGORY_ORDER_EDIT_LABEL,
  helpCategoryDeleteDescription,
  MOVE_DOWN_LABEL,
  MOVE_UP_LABEL,
} from '../../apps/admin/src/components/help/help-messages.ts';
import {
  HELP_ARTICLE_CREATE_ACTION,
  HELP_ARTICLE_DELETE_ACTION,
  HELP_ARTICLE_REORDER_ACTION,
  HELP_ARTICLE_UPDATE_ACTION,
  HELP_CATEGORY_CREATE_ACTION,
  HELP_CATEGORY_DELETE_ACTION,
  HELP_CATEGORY_REORDER_ACTION,
} from '../../apps/common-lib/admin/audit-actions/help-center.ts';
import { HELP_CATEGORY_OTHER_NAME } from '../../apps/common-lib/help/help-category-constants.ts';
import {
  FOOTER_HELP_NAVIGATION_LABEL,
  HELP_TOP_HREF,
} from '../../apps/client/src/components/layout/site-links.ts';
import {
  HELP_TABLE_OF_CONTENTS_LABEL,
  HELP_TOP_TITLE,
} from '../../apps/client/src/components/help/help-messages.ts';
import {
  CATEGORY_CREATE_LABEL,
  CATEGORY_DELETE_LABEL,
} from '../../apps/frontend-lib/utilities/messages/admin-console-messages.ts';
import {
  ADMIN_FLOW_TIMEOUT_MS,
  type BootstrappedAdmin,
  openFromAdminNavigation,
  signInAsNewAdmin,
} from '../support/admin-bootstrap.ts';
import { assumeDistinctClientIp } from '../support/client-ip.ts';
import { uniqueText } from '../client/inquiry/inquiry-steps.ts';
import { requestWithoutFollowing } from '../client/product-steps.ts';
import {
  CATEGORIES_PATH,
  categoryRows,
  createCategory,
  openCategoryDeletionAfterReload,
} from './category-steps.ts';
import { expect, test } from './client-page-test.ts';
import {
  changeHelpArticleHandle,
  createHelpArticle,
  createHelpHandle,
  createHelpSearchToken,
  deleteHelpArticle,
  HELP_ARTICLES_PATH,
  HELP_INDEX_TIMEOUT_MS,
  type HelpArticleInput,
  helpArticleHref,
  helpArticleLinkIn,
  helpArticleOrderList,
  helpCategoryNamesInTable,
  helpSearchPath,
  helpSearchResultsOf,
  moveHelpArticleUp,
  moveHelpCategoryUp,
  openHelpArticleOrder,
  waitForHelpSearchResult,
} from './help-center-steps.ts';

// 記事の作成・並べ替え・利用者側の確認が多いため、管理者2人の用意と索引の更新の待ちに加えて画面の操作の分を足す
const HELP_FLOW_TIMEOUT_MS = 240_000;

test.describe.configure({
  timeout:
    ADMIN_FLOW_TIMEOUT_MS * 2 + HELP_INDEX_TIMEOUT_MS + HELP_FLOW_TIMEOUT_MS,
});

const OK_STATUS = 200;

const REDIRECT_STATUS = 302;

const NOT_FOUND_STATUS = 404;

const AUDITED_HELP_ACTIONS = [
  HELP_CATEGORY_CREATE_ACTION,
  HELP_CATEGORY_REORDER_ACTION,
  HELP_ARTICLE_CREATE_ACTION,
  HELP_ARTICLE_REORDER_ACTION,
  HELP_ARTICLE_UPDATE_ACTION,
  HELP_CATEGORY_DELETE_ACTION,
  HELP_ARTICLE_DELETE_ACTION,
];

interface HelpCenterFixture {
  readonly usageCategory: string;
  readonly pricingCategory: string;
  readonly searchToken: string;
  readonly articleA: HelpArticleInput;
  readonly articleB: HelpArticleInput;
  readonly articleC: HelpArticleInput;
  readonly articleD: HelpArticleInput;
  readonly articleE: HelpArticleInput;
}

const articleInputOf = (
  label: string,
  categoryName: string,
  overrides: Partial<HelpArticleInput> = {},
): HelpArticleInput => ({
  title: uniqueText(`ヘルプ記事${label}`),
  subtitle: `E2Eで確かめる記事${label}のサブタイトル`,
  handle: createHelpHandle(label.toLowerCase()),
  categoryName,
  pinned: false,
  status: 'published',
  body: [{ kind: 'paragraph', text: `E2Eで確かめる記事${label}の本文です。` }],
  ...overrides,
});

// 目次のリンクで見出しへ移る確認のため、Aの本文は見出しの間を長くする
const createFixture = (): HelpCenterFixture => {
  const usageCategory = uniqueText('使い方');
  const pricingCategory = uniqueText('料金');
  const searchToken = createHelpSearchToken();
  const searchParagraph = {
    kind: 'paragraph',
    text: `検索で確かめる語 ${searchToken} を含む本文です。`,
  } as const;
  return {
    usageCategory,
    pricingCategory,
    searchToken,
    articleA: articleInputOf('A', usageCategory, {
      pinned: true,
      body: [
        { kind: 'heading', text: 'はじめる前に' },
        searchParagraph,
        ...Array.from({ length: 12 }, (_, index) => ({
          kind: 'paragraph' as const,
          text: `手順の説明の段落${String(index + 1)}です。`,
        })),
        { kind: 'heading', text: '設定の手順' },
        { kind: 'paragraph', text: '設定の手順の本文です。' },
      ],
    }),
    articleB: articleInputOf('B', usageCategory, {
      status: 'draft',
      body: [searchParagraph],
    }),
    articleC: articleInputOf('C', usageCategory),
    articleD: articleInputOf('D', usageCategory),
    articleE: articleInputOf('E', pricingCategory),
  };
};

const clientMain = (page: Page): Locator => page.getByRole('main');

const helpCategoryRegion = (page: Page, name: string): Locator =>
  clientMain(page).getByRole('region', { name, exact: true });

async function openHelpTop(page: Page): Promise<void> {
  await page.goto(HELP_TOP_HREF);
  await expect(
    clientMain(page).getByRole('heading', { level: 1, name: HELP_TOP_TITLE }),
  ).toBeVisible();
}

async function expectArticleTitles(
  items: Locator,
  titles: readonly string[],
): Promise<void> {
  await expect(items).toHaveCount(titles.length);
  for (const [index, title] of titles.entries()) {
    await expect(items.nth(index)).toContainText(title);
  }
}

async function expectHelpTop(
  page: Page,
  fixture: HelpCenterFixture,
): Promise<void> {
  await openHelpTop(page);
  const headings = await clientMain(page)
    .getByRole('heading', { level: 2 })
    .allInnerTexts();
  const pricingIndex = headings.indexOf(fixture.pricingCategory);
  const usageIndex = headings.indexOf(fixture.usageCategory);
  expect(pricingIndex, 'ヘルプトップに「料金」のカテゴリがありません').not.toBe(
    -1,
  );
  expect(usageIndex).toBe(pricingIndex + 1);

  await expectArticleTitles(
    helpCategoryRegion(page, fixture.usageCategory).getByRole('link'),
    [fixture.articleA.title, fixture.articleD.title, fixture.articleC.title],
  );
  await expect(clientMain(page)).not.toContainText(fixture.articleB.title);

  const footerHelp = page
    .getByRole('contentinfo')
    .getByRole('navigation', { name: FOOTER_HELP_NAVIGATION_LABEL });
  await expect(
    footerHelp.getByRole('link', { name: fixture.articleA.title, exact: true }),
  ).toHaveAttribute('href', helpArticleHref(fixture.articleA.handle));
}

async function expectArticlePage(
  page: Page,
  path: string,
  title: string,
): Promise<void> {
  const response = await page.goto(path);
  expect(response?.status()).toBe(OK_STATUS);
  await expect(
    clientMain(page).getByRole('heading', { level: 1, name: title }),
  ).toBeVisible();
}

async function expectNotFound(page: Page, path: string): Promise<void> {
  const response = await page.goto(path);
  expect(response?.status(), path).toBe(NOT_FOUND_STATUS);
}

// 大文字の表記のURLは転送せずに表示し、正規のURLを現在のハンドルの表記にする。目次のリンクでページ内の見出しへ移る
async function expectArticleByUppercaseHandle(
  page: Page,
  article: HelpArticleInput,
): Promise<void> {
  const uppercasePath = helpArticleHref(article.handle.toUpperCase());
  await expectArticlePage(page, uppercasePath, article.title);
  await expect(page).toHaveURL((url) => url.pathname === uppercasePath);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    new RegExp(`${helpArticleHref(article.handle)}$`, 'u'),
  );

  const lastHeading = article.body.findLast(({ kind }) => kind === 'heading');
  if (lastHeading === undefined) {
    throw new Error('目次を確かめる記事の本文に見出しがありません');
  }
  const tocLink = clientMain(page)
    .getByRole('navigation', { name: HELP_TABLE_OF_CONTENTS_LABEL })
    .getByRole('link', { name: lastHeading.text, exact: true });
  const href = await tocLink.getAttribute('href');
  if (href === null || !href.startsWith('#')) {
    throw new Error(`目次のリンク先が想定と異なります: ${String(href)}`);
  }
  const heading = clientMain(page).getByRole('heading', {
    level: 2,
    name: lastHeading.text,
  });
  // 見出しのIDは英数字以外を百分率符号化した文字列のため、リンク先の断片と同じ文字列になる
  await expect(heading).toHaveAttribute('id', href.slice(1));
  await expect(heading).not.toBeInViewport();
  await tocLink.click();
  await expect(page).toHaveURL((url) => url.hash === href);
  await expect(heading).toBeInViewport();
}

async function expectSearch(
  page: Page,
  fixture: HelpCenterFixture,
): Promise<void> {
  const results = await waitForHelpSearchResult(
    page,
    fixture.searchToken,
    fixture.articleA.title,
  );
  await expect(helpArticleLinkIn(results, fixture.articleB.title)).toHaveCount(
    0,
  );
}

async function expectRedirect(
  page: Page,
  fromHandle: string,
  toHandle: string,
): Promise<void> {
  const redirect = await requestWithoutFollowing(
    page,
    helpArticleHref(fromHandle),
  );
  expect(redirect.status).toBe(REDIRECT_STATUS);
  expect(new URL(redirect.location ?? '', page.url()).pathname).toBe(
    helpArticleHref(toHandle),
  );
}

async function expectServedWithoutRedirect(
  page: Page,
  handle: string,
  title: string,
): Promise<void> {
  const direct = await requestWithoutFollowing(page, helpArticleHref(handle));
  expect(direct).toStrictEqual({ status: OK_STATUS, location: undefined });
  await expectArticlePage(page, helpArticleHref(handle), title);
}

async function deleteUsageCategory(
  page: Page,
  name: string,
  articleCount: number,
): Promise<void> {
  const dialog = await openCategoryDeletionAfterReload(
    page,
    HELP_CATEGORIES_TITLE,
    name,
  );
  await expect(dialog).toContainText(
    helpCategoryDeleteDescription(articleCount),
  );
  await dialog
    .getByRole('button', { name: CATEGORY_DELETE_LABEL, exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(
    categoryRows(page, HELP_CATEGORIES_TITLE).filter({ hasText: name }),
  ).toHaveCount(0);
}

async function expectAuditLogs(
  page: Page,
  admin: BootstrappedAdmin,
): Promise<void> {
  await openFromAdminNavigation(page, admin, '/audit-logs');
  await expect(
    page.getByRole('heading', { level: 1, name: AUDIT_LOGS_TITLE }),
  ).toBeVisible();
  const logRows = page
    .getByRole('table', { name: AUDIT_LOG_LIST_CAPTION })
    .getByRole('row')
    .filter({ hasText: admin.nickname });
  for (const action of AUDITED_HELP_ACTIONS) {
    await expect(
      logRows.filter({ hasText: action.label }).first(),
      action.label,
    ).toBeVisible();
  }
}

// 閲覧のみの管理者には一覧と並び順を見せ、作成・並べ替えの導線を出さない
async function expectViewerCannotEdit(
  page: Page,
  admin: BootstrappedAdmin,
  visibleTitles: readonly string[],
): Promise<void> {
  await openFromAdminNavigation(page, admin, HELP_ARTICLES_PATH);
  await expect(
    page.getByRole('heading', { level: 1, name: HELP_ARTICLES_TITLE }),
  ).toBeVisible();
  const table = page.getByRole('table', { name: HELP_ARTICLE_LIST_CAPTION });
  for (const title of visibleTitles) {
    await expect(table.getByRole('row').filter({ hasText: title })).toHaveCount(
      1,
    );
  }
  await expect(
    page.getByRole('link', { name: HELP_ARTICLE_CREATE_LABEL }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('link', { name: HELP_ARTICLE_ORDER_EDIT_LABEL }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('link', { name: HELP_ARTICLE_ORDER_VIEW_LABEL }),
  ).toBeVisible();

  await openHelpArticleOrder(page, HELP_CATEGORY_OTHER_NAME);
  const others = helpArticleOrderList(page, 'others');
  for (const title of visibleTitles) {
    await expect(others).toContainText(title);
  }
  await expect(
    page.getByRole('main').getByRole('button', { name: MOVE_UP_LABEL }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('main').getByRole('button', { name: MOVE_DOWN_LABEL }),
  ).toHaveCount(0);

  await page.goto(CATEGORIES_PATH);
  const section = page
    .getByRole('main')
    .getByRole('region', { name: HELP_CATEGORIES_TITLE, exact: true });
  await expect(
    section.getByRole('table', { name: HELP_CATEGORIES_TITLE }),
  ).toBeVisible();
  await expect(
    section.getByRole('button', { name: HELP_CATEGORY_ORDER_EDIT_LABEL }),
  ).toHaveCount(0);
  await expect(
    section.getByRole('button', { name: CATEGORY_CREATE_LABEL }),
  ).toHaveCount(0);
}

test.describe('ヘルプセンターの管理画面から利用者側まで', () => {
  test('モデレーターが並べ替えたカテゴリと記事がヘルプトップ・フッター・検索に反映され、下書きは404、旧ハンドルは302、他の記事が旧ハンドルを使うと転送されず、カテゴリの削除で「その他」へ移り、記事の削除で404になり、各操作が監査ログに残り、閲覧のみの管理者は並べ替えと作成の導線を持たない', async ({
    page,
    clientPage,
    browser,
    baseURL,
  }) => {
    const fixture = createFixture();
    const moderator = await signInAsNewAdmin(page, { role: 'moderator' });

    await openFromAdminNavigation(page, moderator, CATEGORIES_PATH);
    await createCategory(page, HELP_CATEGORIES_TITLE, {
      name: fixture.usageCategory,
    });
    await createCategory(page, HELP_CATEGORIES_TITLE, {
      name: fixture.pricingCategory,
    });
    await moveHelpCategoryUp(page, fixture.pricingCategory);
    await expect
      .poll(() =>
        helpCategoryNamesInTable(page, [
          fixture.usageCategory,
          fixture.pricingCategory,
        ]),
      )
      .toStrictEqual([fixture.pricingCategory, fixture.usageCategory]);

    const articleAId = await createHelpArticle(page, fixture.articleA);
    const articleCId = await createHelpArticle(page, fixture.articleC);
    await createHelpArticle(page, fixture.articleD);
    await createHelpArticle(page, fixture.articleB);
    await createHelpArticle(page, fixture.articleE);
    await moveHelpArticleUp(
      page,
      fixture.usageCategory,
      fixture.articleD.title,
    );
    await expectArticleTitles(
      helpArticleOrderList(page, 'others').getByRole('listitem'),
      [fixture.articleD.title, fixture.articleC.title, fixture.articleB.title],
    );

    await expectHelpTop(clientPage, fixture);
    await expectNotFound(clientPage, helpArticleHref(fixture.articleB.handle));
    await expectArticleByUppercaseHandle(clientPage, fixture.articleA);
    await expectSearch(clientPage, fixture);

    const renamedHandleA = createHelpHandle('a2');
    await changeHelpArticleHandle(page, articleAId, renamedHandleA);
    await expectRedirect(clientPage, fixture.articleA.handle, renamedHandleA);

    await changeHelpArticleHandle(page, articleCId, fixture.articleA.handle);
    await expectServedWithoutRedirect(
      clientPage,
      fixture.articleA.handle,
      fixture.articleC.title,
    );

    await openFromAdminNavigation(page, moderator, CATEGORIES_PATH);
    await deleteUsageCategory(page, fixture.usageCategory, 4);
    await openHelpTop(clientPage);
    await expect(
      helpCategoryRegion(clientPage, fixture.usageCategory),
    ).toHaveCount(0);
    const other = helpCategoryRegion(clientPage, HELP_CATEGORY_OTHER_NAME);
    for (const title of [
      fixture.articleA.title,
      fixture.articleC.title,
      fixture.articleD.title,
    ]) {
      await expect(helpArticleLinkIn(other, title)).toHaveCount(1);
    }
    await expect(clientMain(clientPage)).not.toContainText(
      fixture.articleB.title,
    );

    await deleteHelpArticle(page, articleAId, fixture.articleA.title);
    await expectNotFound(clientPage, helpArticleHref(renamedHandleA));
    await clientPage.goto(helpSearchPath(fixture.searchToken));
    await expect(
      helpArticleLinkIn(
        helpSearchResultsOf(clientPage, fixture.searchToken),
        fixture.articleA.title,
      ),
    ).toHaveCount(0);

    await expectAuditLogs(page, moderator);

    const viewerContext = await browser.newContext({ baseURL });
    try {
      await assumeDistinctClientIp(viewerContext, baseURL);
      const viewerPage = await viewerContext.newPage();
      const viewer = await signInAsNewAdmin(viewerPage, { role: 'viewer' });
      await expectViewerCannotEdit(viewerPage, viewer, [
        fixture.articleC.title,
        fixture.articleD.title,
      ]);
    } finally {
      await viewerContext.close();
    }
  });
});
