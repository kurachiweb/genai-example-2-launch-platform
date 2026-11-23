import { expect, type Locator, type Page } from '@playwright/test';

import {
  HELP_ARTICLE_LIST_CAPTION,
  HELP_ORDER_SAVE_LABEL,
  HELP_ORDER_SAVED_MESSAGE,
  HELP_CATEGORIES_TITLE,
  helpCategoryDeleteDescription,
  moveUpName,
} from '../../../apps/admin/src/components/help/help-messages.ts';
import {
  FOOTER_HELP_NAVIGATION_LABEL,
  FOOTER_POLICY_NAVIGATION_LABEL,
  HELP_TOP_HREF,
} from '../../../apps/client/src/components/layout/site-links.ts';
import { LOGIN_LABEL } from '../../../apps/client/src/components/auth/account-messages.ts';
import { HELP_TOP_TITLE } from '../../../apps/client/src/components/help/help-messages.ts';
import {
  LAST_REVISED_LABEL,
  LEGAL_DOCUMENT_PREPARING_MESSAGE,
} from '../../../apps/client/src/components/legal/legal-messages.ts';
import {
  WITHDRAWAL_ACTION_LABEL,
  WITHDRAWAL_CONFIRM_TITLE,
  WITHDRAWAL_SECTION_TITLE,
  WITHDRAWN_MESSAGE,
} from '../../../apps/client/src/components/settings/settings-messages.ts';
import { CATEGORY_DELETE_LABEL } from '../../../apps/frontend-lib/utilities/messages/admin-console-messages.ts';
import {
  CATEGORIES_PATH,
  categoryRows,
  openCategoryDeletionAfterReload,
} from '../../admin/category-steps.ts';
import {
  createHelpArticle,
  createHelpHandle,
  deleteHelpArticle,
  helpArticleHref,
  HELP_ARTICLES_PATH,
  helpArticleOrderList,
  type HelpArticleInput,
  openHelpArticleOrder,
} from '../../admin/help-center-steps.ts';
import {
  currentPasswordField,
  INVALID_CREDENTIALS_MESSAGE,
  loginForm,
  openAccountSettings,
  submitLogin,
  type TestAccount,
  userMenuButton,
  waitForBotToken,
} from '../auth/account-steps.ts';
import { uniqueText } from '../inquiry/inquiry-steps.ts';

// 保存と退会はサーバー側の処理が重く、開発サーバーの負荷で既定の5秒を超えることがある
const SLOW_ACTION_TIMEOUT_MS = 30_000;

const ARTICLE_ID_IN_PATH = /\/help-articles\/([0-9A-Z]{26})$/u;

// 作成の操作の途中で失敗するとIDが得られないため、題名は作成の前に控え、IDは作成の後に入れる
export interface HelpJourneyArticle {
  id: string | undefined;
  readonly title: string;
}

export interface HelpJourneyRecord {
  readonly adminPage: Page;
  categoryName: string | undefined;
  readonly articles: HelpJourneyArticle[];
}

export const createJourneyArticleInput = (
  label: string,
  categoryName: string,
  bodyText: string,
): HelpArticleInput => ({
  title: uniqueText(`回帰のヘルプ記事${label}`),
  subtitle: `回帰の確認で作る記事${label}のサブタイトル`,
  handle: createHelpHandle(`regression-${label.toLowerCase()}`),
  categoryName,
  pinned: true,
  status: 'published',
  body: [{ kind: 'paragraph', text: bodyText }],
});

export async function publishJourneyArticle(
  record: HelpJourneyRecord,
  input: HelpArticleInput,
): Promise<void> {
  const article: HelpJourneyArticle = { id: undefined, title: input.title };
  record.articles.push(article);
  article.id = await createHelpArticle(record.adminPage, input);
}

async function findArticleIdByTitle(
  page: Page,
  title: string,
): Promise<string | undefined> {
  await page.goto(HELP_ARTICLES_PATH);
  const table = page.getByRole('table', { name: HELP_ARTICLE_LIST_CAPTION });
  await expect(table).toBeVisible();
  const link = table.getByRole('link', { name: title, exact: true });
  if ((await link.count()) === 0) {
    return undefined;
  }
  const href = await link.first().getAttribute('href');
  return ARTICLE_ID_IN_PATH.exec(href ?? '')?.[1];
}

async function deleteJourneyCategory(
  page: Page,
  categoryName: string,
): Promise<void> {
  await page.goto(CATEGORIES_PATH);
  await expect(categoryRows(page, HELP_CATEGORIES_TITLE).first()).toBeVisible();
  const created = categoryRows(page, HELP_CATEGORIES_TITLE).filter({
    hasText: categoryName,
  });
  if ((await created.count()) === 0) {
    return;
  }
  const dialog = await openCategoryDeletionAfterReload(
    page,
    HELP_CATEGORIES_TITLE,
    categoryName,
  );
  await expect(dialog).toContainText(helpCategoryDeleteDescription(0));
  await dialog
    .getByRole('button', { name: CATEGORY_DELETE_LABEL, exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
}

// 1つの削除の失敗で残りの削除を飛ばさないよう、全て試してから失敗をまとめて投げる。記事を先に消し、空にしたカテゴリを消す
export async function deleteHelpArticlesAndCategory(
  record: HelpJourneyRecord,
): Promise<void> {
  if (record.categoryName === undefined) {
    return;
  }
  const categoryName = record.categoryName;
  const failures: unknown[] = [];
  for (const article of record.articles) {
    try {
      const id =
        article.id ??
        (await findArticleIdByTitle(record.adminPage, article.title));
      if (id !== undefined) {
        await deleteHelpArticle(record.adminPage, id, article.title);
      }
    } catch (error) {
      failures.push(error);
    }
  }
  try {
    await deleteJourneyCategory(record.adminPage, categoryName);
  } catch (error) {
    failures.push(error);
  }
  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      `ヘルプのカテゴリ「${categoryName}」と記事の後片付けに失敗しました`,
    );
  }
}

const clientMain = (page: Page): Locator => page.getByRole('main');

async function expectTitlesInOrder(
  items: Locator,
  titles: readonly string[],
): Promise<void> {
  await expect(items).toHaveCount(titles.length);
  for (const [index, title] of titles.entries()) {
    await expect(items.nth(index)).toContainText(title);
  }
}

export async function expectPinnedOrderInAdmin(
  page: Page,
  categoryName: string,
  titles: readonly string[],
): Promise<void> {
  await openHelpArticleOrder(page, categoryName);
  await expectTitlesInOrder(
    helpArticleOrderList(page, 'pinned').getByRole('listitem'),
    titles,
  );
}

// ピン留めの群の中で指定した記事を1つ上へ移して保存する
export async function movePinnedArticleUp(
  page: Page,
  categoryName: string,
  title: string,
): Promise<void> {
  await openHelpArticleOrder(page, categoryName);
  await helpArticleOrderList(page, 'pinned')
    .getByRole('button', { name: moveUpName(title), exact: true })
    .click();
  await page
    .getByRole('main')
    .getByRole('button', { name: HELP_ORDER_SAVE_LABEL, exact: true })
    .click();
  await expect(page.getByText(HELP_ORDER_SAVED_MESSAGE).first()).toBeVisible({
    timeout: SLOW_ACTION_TIMEOUT_MS,
  });
}

export async function expectHelpTopOrder(
  page: Page,
  categoryName: string,
  titles: readonly string[],
): Promise<void> {
  await page.goto(HELP_TOP_HREF);
  await expect(
    clientMain(page).getByRole('heading', { level: 1, name: HELP_TOP_TITLE }),
  ).toBeVisible();
  await expectTitlesInOrder(
    clientMain(page)
      .getByRole('region', { name: categoryName, exact: true })
      .getByRole('link'),
    titles,
  );
}

// フッターの一覧は他の記事も含むため、指定したハンドルの相対的な順だけを返す。ピン留めの取得はハイドレーションの後に行われるため、ポーリングで待つ
export async function expectFooterRelativeOrder(
  page: Page,
  handles: readonly string[],
): Promise<void> {
  const hrefs = handles.map((handle) => helpArticleHref(handle));
  const links = page
    .getByRole('contentinfo')
    .getByRole('navigation', { name: FOOTER_HELP_NAVIGATION_LABEL })
    .getByRole('link');
  await expect
    .poll(async () => {
      const present = await links.evaluateAll((anchors) =>
        anchors.map((anchor) => anchor.getAttribute('href')),
      );
      return present.filter((href) => href !== null && hrefs.includes(href));
    })
    .toStrictEqual(hrefs);
}

export const footerPolicyNavigation = (page: Page): Locator =>
  page
    .getByRole('contentinfo')
    .getByRole('navigation', { name: FOOTER_POLICY_NAVIGATION_LABEL });

export const documentHeading = (page: Page, label: string): Locator =>
  page
    .getByRole('main')
    .getByRole('heading', { level: 1, name: label, exact: true });

// 見出しは読み込み中・失敗の表示でも文書の名前になるため、取得に成功した時だけ出る公開済み(最終改訂日)か準備中の表示で到達を確かめる
export async function expectLoadedLegalDocument(page: Page): Promise<void> {
  const main = page.getByRole('main');
  await expect(
    main
      .getByText(LEGAL_DOCUMENT_PREPARING_MESSAGE)
      .or(main.getByRole('term').filter({ hasText: LAST_REVISED_LABEL })),
  ).toBeVisible();
  await expect(main.getByRole('alert')).toHaveCount(0);
}

export async function withdrawAccount(
  page: Page,
  account: TestAccount,
): Promise<void> {
  await openAccountSettings(page, account);
  await page
    .getByRole('region', { name: WITHDRAWAL_SECTION_TITLE })
    .getByRole('button', { name: WITHDRAWAL_ACTION_LABEL })
    .click();
  const dialog = page.getByRole('dialog', { name: WITHDRAWAL_CONFIRM_TITLE });
  const form = dialog.getByRole('form', { name: WITHDRAWAL_SECTION_TITLE });
  await waitForBotToken(form);
  await currentPasswordField(form).fill(account.password);
  await form.getByRole('button', { name: WITHDRAWAL_ACTION_LABEL }).click();
}

export async function expectLoggedOutAfterWithdrawal(
  page: Page,
  account: TestAccount,
): Promise<void> {
  await expect(page.getByText(WITHDRAWN_MESSAGE)).toBeVisible({
    timeout: SLOW_ACTION_TIMEOUT_MS,
  });
  await expect(page).toHaveURL('/');
  await expect(
    page.getByRole('banner').getByRole('link', { name: LOGIN_LABEL }),
  ).toBeVisible();
  await expect(userMenuButton(page, account)).toHaveCount(0);
}

export async function expectLoginRejected(
  page: Page,
  account: TestAccount,
): Promise<void> {
  await page.goto('/auth/login');
  await submitLogin(page, account.email, account.password);
  await expect(
    loginForm(page)
      .getByRole('alert')
      .filter({ hasText: INVALID_CREDENTIALS_MESSAGE }),
  ).toBeVisible();
}
