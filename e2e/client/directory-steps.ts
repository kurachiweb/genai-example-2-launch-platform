import { expect, type Locator, type Page } from '@playwright/test';

import type { DirectorySort } from '../../apps/common-lib/directory/directory-query-rules.ts';
import { CATEGORY_PICKER_LABEL } from '../../apps/client/src/components/directory/category-picker-messages.ts';
import { DIRECTORY_LIST_HEADING } from '../../apps/client/src/components/directory/directory-list-messages.ts';
import { DIRECTORY_PAGE_TITLE } from '../../apps/client/src/components/directory/directory-page-messages.ts';
import {
  DIRECTORY_PAGINATION_LABEL,
  pageNumberName,
} from '../../apps/client/src/components/directory/directory-pagination-messages.ts';
import {
  SEARCH_FORM_LABEL,
  SEARCH_INPUT_LABEL,
  SEARCH_SUBMIT_LABEL,
} from '../../apps/client/src/components/directory/search-form-messages.ts';
import {
  SORT_LABELS,
  SORT_SELECT_LABEL,
} from '../../apps/client/src/components/directory/sort-select-messages.ts';
import { DIRECTORY_HREF } from '../../apps/client/src/components/layout/site-links.ts';
import {
  launchMatchesLabel,
  MATCH_HISTORY_TITLE,
  OUTCOME_LABELS,
  scoreLabel,
  supportersToggleLabel,
} from '../../apps/client/src/components/product-page/match-history-messages.ts';
import { SUPPORTERS_LIST_LABEL } from '../../apps/client/src/components/product-page/supporters-panel-messages.ts';
import { UNLISTED_NOTICE_LEAD } from '../../apps/client/src/components/product-page/unlisted-banner-messages.ts';
import {
  REACTION_TIMEOUT_MS,
  RETRY_TIMEOUT_MS,
} from '../support/hydration-retry.ts';

export interface DirectorySearchWaitOptions {
  readonly timeoutMs?: number;
}

export interface DirectoryPeriod {
  readonly from: string;
  readonly to: string;
}

// 確定のイベントから予選の結果の記録・掲載の記録・索引の更新までにQueueを2回経るため、Queueのまとめの待ちと開発サーバーの初回の変換の遅れを含めて待つ
export const DIRECTORY_INDEX_TIMEOUT_MS = 90_000;

const DIRECTORY_INDEX_POLL_INTERVAL_MS = 2_000;

const NOT_FOUND_STATUS = 404;

const FIRST_LAUNCH_NUMBER = 1;

// ルーターはJSONとして読めない文字列のクエリをそのまま書き出すため、名称のような語や日付はエンコードだけで同じURLになる
const directoryPathOf = (params: Readonly<Record<string, string>>): string =>
  `${DIRECTORY_HREF}?${new URLSearchParams(params).toString()}`;

export const directorySearchPath = (term: string): string =>
  directoryPathOf({ q: term });

export const directoryPeriodPath = ({ from, to }: DirectoryPeriod): string =>
  directoryPathOf({ from, to });

export const productPagePath = (handle: string): string =>
  `${DIRECTORY_HREF}/${handle}`;

export const directoryItemOf = (page: Page, productName: string): Locator =>
  page.getByRole('article', { name: productName, exact: true });

export const directoryListOf = (page: Page): Locator =>
  page.getByRole('region', { name: DIRECTORY_LIST_HEADING, exact: true });

// 件数の表示は「21件中1〜20件」のように数だけが変わるため、表示中の範囲で確かめる
export const resultCountOf = (page: Page, pattern: RegExp): Locator =>
  directoryListOf(page).getByText(pattern);

export const searchParamOf = (page: Page, name: string): string | null =>
  new URL(page.url()).searchParams.get(name);

// 索引は非同期に作られるため、名称で検索したディレクトリを読み込み直し、勝ったプロダクトの項目が現れるまで待つ
export async function waitForDirectorySearchResult(
  page: Page,
  productName: string,
  { timeoutMs = DIRECTORY_INDEX_TIMEOUT_MS }: DirectorySearchWaitOptions = {},
): Promise<Locator> {
  const item = directoryItemOf(page, productName);
  await expect(
    async () => {
      await page.goto(directorySearchPath(productName));
      await expect(item).toBeVisible({ timeout: REACTION_TIMEOUT_MS });
    },
    `ディレクトリの検索に「${productName}」が${String(timeoutMs / 1000)}秒以内に現れません。APIサーバーの23:40の確定のジョブと、イベントサーバーの予選の結果の記録・掲載の記録・索引の更新の処理のログを確かめてください`,
  ).toPass({
    intervals: [DIRECTORY_INDEX_POLL_INTERVAL_MS],
    timeout: timeoutMs,
  });
  return item;
}

export async function openDirectory(
  page: Page,
  path = DIRECTORY_HREF,
): Promise<void> {
  await page.goto(path);
  await expect(
    page.getByRole('heading', { level: 1, name: DIRECTORY_PAGE_TITLE }),
  ).toBeVisible();
}

// ハイドレーションの前の送信はブラウザの既定の送信になり検索語が外れるため、URLに検索語が入るまで送り直す
export async function searchDirectory(page: Page, term: string): Promise<void> {
  const form = page.getByRole('search', { name: SEARCH_FORM_LABEL });
  await expect(async () => {
    await form
      .getByRole('searchbox', { name: SEARCH_INPUT_LABEL, exact: true })
      .fill(term, { timeout: REACTION_TIMEOUT_MS });
    await form
      .getByRole('button', { name: SEARCH_SUBMIT_LABEL, exact: true })
      .click({ timeout: REACTION_TIMEOUT_MS });
    await expect(page).toHaveURL(() => searchParamOf(page, 'q') === term, {
      timeout: REACTION_TIMEOUT_MS,
    });
  }).toPass({ timeout: RETRY_TIMEOUT_MS });
}

// 選択欄のボタンの名前は「<項目名> <選択中の値>」のため、項目名で始まるボタンを探す
const filterTriggerOf = (page: Page, label: string): Locator =>
  page.getByRole('button', { name: new RegExp(`^${label} `, 'u') });

// ハイドレーションの前に押した開閉のボタンは何もしないため、選択肢が現れるまで押し直す
async function openFilterMenu(
  trigger: Locator,
  choice: Locator,
): Promise<void> {
  await expect(async () => {
    if (!(await choice.isVisible())) {
      await trigger.click({ timeout: REACTION_TIMEOUT_MS });
    }
    await expect(choice).toBeVisible({ timeout: REACTION_TIMEOUT_MS });
  }).toPass({ timeout: RETRY_TIMEOUT_MS });
}

export async function chooseDirectoryCategory(
  page: Page,
  categoryName: string,
): Promise<void> {
  const trigger = filterTriggerOf(page, CATEGORY_PICKER_LABEL);
  await expect(trigger).toBeEnabled();
  const option = page
    .getByRole('listbox', { name: CATEGORY_PICKER_LABEL, exact: true })
    .getByRole('option', { name: categoryName, exact: true });
  await openFilterMenu(trigger, option);
  await option.click();
  await expect(trigger).toHaveAccessibleName(
    `${CATEGORY_PICKER_LABEL} ${categoryName}`,
  );
}

export async function chooseDirectorySort(
  page: Page,
  sort: DirectorySort,
): Promise<void> {
  const trigger = filterTriggerOf(page, SORT_SELECT_LABEL);
  const item = page.getByRole('menuitemradio', {
    name: SORT_LABELS[sort],
    exact: true,
  });
  await openFilterMenu(trigger, item);
  await item.click();
  await expect(trigger).toHaveAccessibleName(
    `${SORT_SELECT_LABEL} ${SORT_LABELS[sort]}`,
  );
  await expect(page).toHaveURL(() => searchParamOf(page, 'sort') === sort);
}

// ページ送りの番号はリンクのため、ハイドレーションの前に押してもそのページへ移る
export async function moveToDirectoryPage(
  page: Page,
  pageNumber: number,
): Promise<void> {
  const link = page
    .getByRole('navigation', { name: DIRECTORY_PAGINATION_LABEL, exact: true })
    .getByRole('link', {
      name: pageNumberName(String(pageNumber)),
      exact: true,
    });
  await link.click();
  await expect(page).toHaveURL(
    () => searchParamOf(page, 'page') === String(pageNumber),
  );
  await expect(link).toHaveAttribute('aria-current', 'page');
}

export async function readDirectoryItemNames(
  page: Page,
): Promise<readonly string[]> {
  return directoryListOf(page)
    .getByRole('article')
    .getByRole('heading', { level: 3 })
    .allInnerTexts();
}

export async function openProductFromDirectory(
  page: Page,
  productName: string,
  handle: string,
): Promise<void> {
  await directoryItemOf(page, productName)
    .getByRole('link', { name: productName, exact: true })
    .click();
  await expect(page).toHaveURL(
    (url) => url.pathname === productPagePath(handle),
  );
  await expect(
    page.getByRole('heading', { level: 1, name: productName, exact: true }),
  ).toBeVisible();
}

const firstLaunchMatches = (page: Page): Locator =>
  page.getByRole('region', { name: MATCH_HISTORY_TITLE }).getByRole('list', {
    name: launchMatchesLabel(FIRST_LAUNCH_NUMBER),
    exact: true,
  });

// 詳細ページのマッチ履歴の初回のローンチに、確定した予選の結果とUpvote数(自分の側を先)が出る
export async function expectQualifierHistory(
  page: Page,
  outcome: 'won' | 'lost',
  [own, opponent]: readonly [number, number],
): Promise<Locator> {
  const row = firstLaunchMatches(page).getByRole('listitem').first();
  await expect(
    row.getByText(OUTCOME_LABELS[outcome], { exact: true }),
  ).toBeVisible();
  await expect(
    row.getByText(scoreLabel(String(own), String(opponent)), { exact: true }),
  ).toBeVisible();
  return row;
}

// サポーターの一覧は開いた時に取得するため、ハイドレーションの前に押した開閉のボタンが何もしなければ押し直す
export async function expectSupporters(
  row: Locator,
  supporterNicknames: readonly string[],
): Promise<void> {
  const toggle = row.getByRole('button', {
    name: supportersToggleLabel(String(supporterNicknames.length)),
    exact: true,
  });
  await expect(async () => {
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
      await toggle.click({ timeout: REACTION_TIMEOUT_MS });
    }
    await expect(toggle).toHaveAttribute('aria-expanded', 'true', {
      timeout: REACTION_TIMEOUT_MS,
    });
  }).toPass({ timeout: RETRY_TIMEOUT_MS });
  const list = row.getByRole('list', {
    name: SUPPORTERS_LIST_LABEL,
    exact: true,
  });
  // 項目の文字には順位とプロフィール画像の代わりの頭文字が混ざるため、リンクの名前(ニックネーム)で確かめる
  const links = list.getByRole('link');
  await expect(links).toHaveCount(supporterNicknames.length);
  await Promise.all(
    supporterNicknames.map((nickname, index) =>
      expect(links.nth(index)).toHaveAccessibleName(nickname),
    ),
  );
}

export async function expectProductNotFound(
  page: Page,
  handle: string,
): Promise<void> {
  const response = await page.goto(productPagePath(handle));
  expect(response?.status()).toBe(NOT_FOUND_STATUS);
}

// 未掲載のプロダクトの詳細ページは、投稿者本人にだけ未掲載の案内付きで出る
export async function expectUnlistedOwnProductPage(
  page: Page,
  productName: string,
  handle: string,
): Promise<void> {
  await page.goto(productPagePath(handle));
  await expect(
    page.getByRole('heading', { level: 1, name: productName, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('note').filter({ hasText: UNLISTED_NOTICE_LEAD }),
  ).toBeVisible();
}
