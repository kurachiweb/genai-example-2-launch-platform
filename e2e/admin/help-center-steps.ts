import { randomBytes } from 'node:crypto';

import { expect, type Locator, type Page } from '@playwright/test';

import {
  HELP_ARTICLE_CREATE_SUBMIT_LABEL,
  HELP_ARTICLE_CREATED_MESSAGE,
  HELP_ARTICLE_DELETE_CONFIRM_LABEL,
  HELP_ARTICLE_DELETE_LABEL,
  HELP_ARTICLE_DELETED_MESSAGE,
  HELP_ARTICLE_FORM_CREATE_LABEL,
  HELP_ARTICLE_FORM_EDIT_LABEL,
  HELP_ARTICLE_FORM_LABELS,
  HELP_ARTICLE_ORDER_CATEGORY_LABEL,
  HELP_ARTICLE_ORDER_TITLE,
  HELP_ARTICLE_SAVE_SUBMIT_LABEL,
  HELP_ARTICLE_SAVED_MESSAGE,
  HELP_CATEGORIES_TITLE,
  HELP_CATEGORY_ORDER_EDIT_LABEL,
  HELP_CATEGORY_ORDER_LIST_LABEL,
  HELP_ORDER_SAVE_LABEL,
  HELP_ORDER_SAVED_MESSAGE,
  HELP_OTHER_ARTICLES_LABEL,
  HELP_PINNED_ARTICLES_LABEL,
  helpArticleDeleteTitle,
  moveUpName,
} from '../../apps/admin/src/components/help/help-messages.ts';
import {
  HELP_ARTICLE_STATUS_LABELS,
  type HelpArticleStatus,
} from '../../apps/common-lib/help/help-article-status.ts';
import {
  BOLD_ACTION_LABEL,
  FORMAT_TOOLBAR_LABEL,
} from '../../apps/frontend-lib/utilities/messages/markdown-messages.ts';
import { helpSearchResultsHeading } from '../../apps/client/src/components/help/help-messages.ts';
import {
  HELP_TOP_HREF,
  helpArticleHref,
} from '../../apps/client/src/components/layout/site-links.ts';
import { markdownEditable } from '../client/markdown-steps.ts';
import {
  REACTION_TIMEOUT_MS,
  RETRY_TIMEOUT_MS,
} from '../support/hydration-retry.ts';
import { categoryRows, categorySection } from './category-steps.ts';

export const HELP_ARTICLES_PATH = '/help-articles';

const HELP_ARTICLE_NEW_PATH = `${HELP_ARTICLES_PATH}/new`;

const HELP_ARTICLE_ORDER_PATH = `${HELP_ARTICLES_PATH}/order`;

// 公開の保存から索引の更新までにQueueを1回経るため、Queueのまとめの待ちと開発サーバーの初回の変換の遅れを含めて待つ
export const HELP_INDEX_TIMEOUT_MS = 90_000;

const HELP_INDEX_POLL_INTERVAL_MS = 2_000;

const ARTICLE_ID_PATTERN = /^\/help-articles\/([0-9A-Z]{26})$/u;

export type HelpBodyBlock =
  | { readonly kind: 'heading'; readonly text: string }
  | { readonly kind: 'paragraph'; readonly text: string };

export interface HelpArticleInput {
  readonly title: string;
  readonly subtitle: string;
  readonly handle: string;
  readonly categoryName: string;
  readonly pinned: boolean;
  readonly status: HelpArticleStatus;
  readonly body: readonly HelpBodyBlock[];
}

// 前の実行で作った記事とハンドルが重ならないよう、乱数から作る。大文字の表記で開く確認のため英小文字で始める
export const createHelpHandle = (label: string): string =>
  `e2e-help-${label}-${randomBytes(6).toString('hex')}`;

// 索引の語は空白で区切られるため、本文では前後に空白を置いて1語として書く
export const createHelpSearchToken = (): string =>
  `e2ehelp${randomBytes(6).toString('hex')}`;

export const helpArticleEditPath = (articleId: string): string =>
  `${HELP_ARTICLES_PATH}/${articleId}`;

export const helpSearchPath = (query: string): string =>
  `${HELP_TOP_HREF}?${new URLSearchParams({ q: query }).toString()}`;

export { helpArticleHref };

const helpArticleForm = (page: Page, label: string): Locator =>
  page.getByRole('form', { name: label, exact: true });

// 入力欄は読み込みの後に編集できるようになるため、書式のツールが押せるようになってから(ハイドレーションの後に)入力する
async function waitForHelpArticleForm(
  page: Page,
  label: string,
): Promise<Locator> {
  const form = helpArticleForm(page, label);
  await expect(
    form
      .getByRole('toolbar', { name: FORMAT_TOOLBAR_LABEL })
      .getByRole('button', { name: BOLD_ACTION_LABEL, exact: true }),
  ).toBeEnabled();
  return form;
}

async function chooseOption(
  page: Page,
  combobox: Locator,
  optionLabel: string,
): Promise<void> {
  const option = page.getByRole('option', { name: optionLabel, exact: true });
  await expect(async () => {
    if (!(await option.isVisible())) {
      await combobox.click();
    }
    await expect(option).toBeVisible({ timeout: REACTION_TIMEOUT_MS });
  }).toPass({ timeout: RETRY_TIMEOUT_MS });
  await option.click();
  await expect(combobox).toContainText(optionLabel);
}

// 見出しは行頭の「## 」の入力で見出しのブロックに変わる。各ブロックの後で改行し、次のブロックを段落から始める
async function typeHelpBody(
  page: Page,
  form: Locator,
  blocks: readonly HelpBodyBlock[],
): Promise<void> {
  const editable = markdownEditable(form, HELP_ARTICLE_FORM_LABELS.body);
  await editable.click();
  for (const block of blocks) {
    await page.keyboard.type(
      block.kind === 'heading' ? `## ${block.text}` : block.text,
    );
    await page.keyboard.press('Enter');
  }
  for (const block of blocks.filter(({ kind }) => kind === 'heading')) {
    await expect(
      editable.getByRole('heading', { level: 2, name: block.text }),
    ).toBeVisible();
  }
}

const articleIdOf = (page: Page): string => {
  const matched = ARTICLE_ID_PATTERN.exec(new URL(page.url()).pathname);
  if (matched?.[1] === undefined) {
    throw new Error(`記事の編集画面のURLが想定と異なります: ${page.url()}`);
  }
  return matched[1];
};

// 作成の後に移る編集画面のURLから記事のIDを読んで返す
export async function createHelpArticle(
  page: Page,
  input: HelpArticleInput,
): Promise<string> {
  await page.goto(HELP_ARTICLE_NEW_PATH);
  const form = await waitForHelpArticleForm(
    page,
    HELP_ARTICLE_FORM_CREATE_LABEL,
  );
  await form
    .getByLabel(HELP_ARTICLE_FORM_LABELS.title, { exact: true })
    .fill(input.title);
  await form
    .getByLabel(HELP_ARTICLE_FORM_LABELS.subtitle, { exact: true })
    .fill(input.subtitle);
  await form
    .getByLabel(HELP_ARTICLE_FORM_LABELS.handle, { exact: true })
    .fill(input.handle);
  await chooseOption(
    page,
    form.getByRole('combobox', { name: HELP_ARTICLE_FORM_LABELS.categoryId }),
    input.categoryName,
  );
  if (input.pinned) {
    await form.getByRole('checkbox').check();
  }
  await form
    .getByRole('radio', {
      name: HELP_ARTICLE_STATUS_LABELS[input.status],
      exact: true,
    })
    .check();
  await typeHelpBody(page, form, input.body);
  await form
    .getByRole('button', {
      name: HELP_ARTICLE_CREATE_SUBMIT_LABEL,
      exact: true,
    })
    .click();

  await expect(
    page.getByText(HELP_ARTICLE_CREATED_MESSAGE).first(),
  ).toBeVisible();
  await expect(page).toHaveURL((url) => ARTICLE_ID_PATTERN.test(url.pathname));
  await expect(
    page.getByRole('heading', { level: 1, name: HELP_ARTICLE_FORM_EDIT_LABEL }),
  ).toBeVisible();
  return articleIdOf(page);
}

export async function changeHelpArticleHandle(
  page: Page,
  articleId: string,
  handle: string,
): Promise<void> {
  await page.goto(helpArticleEditPath(articleId));
  const form = await waitForHelpArticleForm(page, HELP_ARTICLE_FORM_EDIT_LABEL);
  await form
    .getByLabel(HELP_ARTICLE_FORM_LABELS.handle, { exact: true })
    .fill(handle);
  await form
    .getByRole('button', { name: HELP_ARTICLE_SAVE_SUBMIT_LABEL, exact: true })
    .click();
  await expect(
    page.getByText(HELP_ARTICLE_SAVED_MESSAGE).first(),
  ).toBeVisible();
  await expect(
    form.getByLabel(HELP_ARTICLE_FORM_LABELS.handle, { exact: true }),
  ).toHaveValue(handle);
}

export async function deleteHelpArticle(
  page: Page,
  articleId: string,
  title: string,
): Promise<void> {
  await page.goto(helpArticleEditPath(articleId));
  await waitForHelpArticleForm(page, HELP_ARTICLE_FORM_EDIT_LABEL);
  const dialog = page.getByRole('dialog', {
    name: helpArticleDeleteTitle(title),
  });
  await expect(async () => {
    if (!(await dialog.isVisible())) {
      await page
        .getByRole('main')
        .getByRole('button', { name: HELP_ARTICLE_DELETE_LABEL, exact: true })
        .click();
    }
    await expect(dialog).toBeVisible({ timeout: REACTION_TIMEOUT_MS });
  }).toPass({ timeout: RETRY_TIMEOUT_MS });
  await dialog
    .getByRole('button', {
      name: HELP_ARTICLE_DELETE_CONFIRM_LABEL,
      exact: true,
    })
    .click();
  await expect(
    page.getByText(HELP_ARTICLE_DELETED_MESSAGE).first(),
  ).toBeVisible();
  await expect(page).toHaveURL((url) => url.pathname === HELP_ARTICLES_PATH);
}

// カテゴリの区画の並べ替えを始め、指定したカテゴリを1つ上へ移して保存する
export async function moveHelpCategoryUp(
  page: Page,
  categoryName: string,
): Promise<void> {
  const section = categorySection(page, HELP_CATEGORIES_TITLE);
  const list = section.getByRole('list', {
    name: HELP_CATEGORY_ORDER_LIST_LABEL,
    exact: true,
  });
  await expect(async () => {
    if (!(await list.isVisible())) {
      await section
        .getByRole('button', {
          name: HELP_CATEGORY_ORDER_EDIT_LABEL,
          exact: true,
        })
        .click();
    }
    await expect(list).toBeVisible({ timeout: REACTION_TIMEOUT_MS });
  }).toPass({ timeout: RETRY_TIMEOUT_MS });
  await list
    .getByRole('button', { name: moveUpName(categoryName), exact: true })
    .click();
  await section
    .getByRole('button', { name: HELP_ORDER_SAVE_LABEL, exact: true })
    .click();
  await expect(page.getByText(HELP_ORDER_SAVED_MESSAGE).first()).toBeVisible();
  await expect(list).toHaveCount(0);
}

// 区画の表の行の並びで、カテゴリ名の順を返す
export async function helpCategoryNamesInTable(
  page: Page,
  names: readonly string[],
): Promise<readonly string[]> {
  const texts = await categoryRows(page, HELP_CATEGORIES_TITLE).allInnerTexts();
  return texts.flatMap((text) => names.filter((name) => text.includes(name)));
}

export const helpArticleOrderList = (
  page: Page,
  group: 'pinned' | 'others',
): Locator =>
  page.getByRole('main').getByRole('list', {
    name:
      group === 'pinned'
        ? HELP_PINNED_ARTICLES_LABEL
        : HELP_OTHER_ARTICLES_LABEL,
    exact: true,
  });

export async function openHelpArticleOrder(
  page: Page,
  categoryName: string,
): Promise<void> {
  await page.goto(HELP_ARTICLE_ORDER_PATH);
  await expect(
    page.getByRole('heading', { level: 1, name: HELP_ARTICLE_ORDER_TITLE }),
  ).toBeVisible();
  await chooseOption(
    page,
    page.getByRole('combobox', { name: HELP_ARTICLE_ORDER_CATEGORY_LABEL }),
    categoryName,
  );
}

// 並べ替えの画面でカテゴリを選び、ピン留めでない記事を1つ上へ移して保存する
export async function moveHelpArticleUp(
  page: Page,
  categoryName: string,
  title: string,
): Promise<void> {
  await openHelpArticleOrder(page, categoryName);
  const others = helpArticleOrderList(page, 'others');
  await others
    .getByRole('button', { name: moveUpName(title), exact: true })
    .click();
  await page
    .getByRole('main')
    .getByRole('button', { name: HELP_ORDER_SAVE_LABEL, exact: true })
    .click();
  await expect(page.getByText(HELP_ORDER_SAVED_MESSAGE).first()).toBeVisible();
}

export const helpSearchResultsOf = (page: Page, query: string): Locator =>
  page.getByRole('main').getByRole('region', {
    name: helpSearchResultsHeading(query),
    exact: true,
  });

export const helpArticleLinkIn = (scope: Locator, title: string): Locator =>
  scope.getByRole('link').filter({ hasText: title });

// 索引は非同期に作られるため、検索のページを読み込み直し、記事が結果に現れるまで待つ
export async function waitForHelpSearchResult(
  page: Page,
  query: string,
  title: string,
): Promise<Locator> {
  const results = helpSearchResultsOf(page, query);
  await expect(
    async () => {
      await page.goto(helpSearchPath(query));
      await expect(helpArticleLinkIn(results, title)).toBeVisible({
        timeout: REACTION_TIMEOUT_MS,
      });
    },
    `ヘルプの検索に「${title}」が${String(HELP_INDEX_TIMEOUT_MS / 1000)}秒以内に現れません。APIサーバーの記事の保存(索引の更新の予約と送信)と、イベントサーバーの索引の更新(help-article)の処理のログを確かめてください`,
  ).toPass({
    intervals: [HELP_INDEX_POLL_INTERVAL_MS],
    timeout: HELP_INDEX_TIMEOUT_MS,
  });
  return results;
}
