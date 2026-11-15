import type { BrowserContext, Page } from '@playwright/test';

import {
  PRODUCT_CATEGORY_OTHER_HANDLE,
  PRODUCT_CATEGORY_OTHER_NAME,
} from '../../apps/common-lib/product/product-category-constants.ts';
import { DIRECTORY_PAGE_SIZE } from '../../apps/common-lib/directory/directory-query-rules.ts';
import { assumeDistinctClientIp } from '../support/client-ip.ts';
import {
  createEndedQualifier,
  createListedProducts,
} from '../support/directory-fixtures.ts';
import { triggerScheduled } from '../support/scheduled-trigger.ts';
import {
  createTestAccount,
  MAIL_FLOW_TIMEOUT_MS,
  type TestAccount,
} from './auth/account-steps.ts';
import { expect, test as base } from './auth/auth-test.ts';
import {
  chooseDirectoryCategory,
  chooseDirectorySort,
  DIRECTORY_INDEX_TIMEOUT_MS,
  directoryItemOf,
  directoryPeriodPath,
  expectProductNotFound,
  expectQualifierHistory,
  expectSupporters,
  expectUnlistedOwnProductPage,
  moveToDirectoryPage,
  openDirectory,
  openProductFromDirectory,
  productPagePath,
  readDirectoryItemNames,
  resultCountOf,
  searchDirectory,
  searchParamOf,
  waitForDirectorySearchResult,
} from './directory-steps.ts';
import {
  isNearQualifierFullTime,
  QUALIFIER_FULL_TIME_SKIP_REASON,
} from './match-steps.ts';
import {
  createProductHandle,
  createProductInput,
  fillProduct,
  fillProductHandle,
  openProductEditor,
  openProductRegistration,
  PRODUCT_FLOW_TIMEOUT_MS,
  type ProductInput,
  registerProduct,
  requestWithoutFollowing,
  saveProductChanges,
  upcomingLaunchDates,
} from './product-steps.ts';
import {
  openProfileEditor,
  readCurrentHandle,
  registerVerifiedAccount,
} from './profile-steps.ts';

interface UserPageFixtures {
  // 投稿者2人とサポーターを並べる流れのため、呼ぶたびに別の接続元を名乗る別のブラウザの文脈で開く。開いた文脈はテストの終わりに閉じる
  readonly openUserPage: () => Promise<Page>;
}

const test = base.extend<UserPageFixtures>({
  openUserPage: async ({ browser, baseURL }, use) => {
    const contexts: BrowserContext[] = [];
    try {
      await use(async () => {
        const context = await browser.newContext({ baseURL });
        contexts.push(context);
        await assumeDistinctClientIp(context, baseURL);
        return context.newPage();
      });
    } finally {
      await Promise.all(contexts.map((context) => context.close()));
    }
  },
});

// 2人のプロダクトの登録・サポーターの登録・索引の待ちに、ディレクトリと詳細ページの確認とハンドルの変更の分を足す
test.describe.configure({
  timeout:
    PRODUCT_FLOW_TIMEOUT_MS * 2 +
    MAIL_FLOW_TIMEOUT_MS * 2 +
    DIRECTORY_INDEX_TIMEOUT_MS,
});

const QUALIFIER_FULL_TIME = '23:40';

const REDIRECT_STATUS = 302;

const SINGLE_RESULT_PATTERN = /^1件$/u;

const FIRST_PAGE_COUNT_PATTERN = new RegExp(
  `^[\\d,]+件中1〜${String(DIRECTORY_PAGE_SIZE)}件$`,
  'u',
);

const SECOND_PAGE_COUNT_PATTERN = new RegExp(
  `^[\\d,]+件中${String(DIRECTORY_PAGE_SIZE + 1)}〜[\\d,]+件$`,
  'u',
);

// ローンチ日は画面で選べる日に登録し、予選の補助が当日へ書き換える
async function registerOwnerProduct(page: Page): Promise<ProductInput> {
  await registerVerifiedAccount(page, createTestAccount());
  const input = createProductInput();
  const [launchDate] = upcomingLaunchDates();
  const form = await openProductRegistration(page);
  await fillProduct(page, form, input, launchDate);
  await registerProduct(page, form);
  return input;
}

async function registerSupporter(
  page: Page,
): Promise<{ readonly account: TestAccount; readonly handle: string }> {
  const account = createTestAccount();
  await registerVerifiedAccount(page, account);
  const handle = await readCurrentHandle(
    await openProfileEditor(page, account),
  );
  return { account, handle };
}

test.describe('ディレクトリと詳細ページ', () => {
  test('当日の予選で勝ったプロダクトがディレクトリの検索・カテゴリの絞り込み・Upvote数が多い順に出て、2ページ目へ移ると件数とページの位置が変わり、詳細ページにマッチ履歴とサポーターが出て、敗けたプロダクトは他者には404で投稿者には未掲載の案内付きで出て、ハンドルを変えると旧ハンドルのURLが転送される', async ({
    page,
    openUserPage,
  }) => {
    test.skip(
      isNearQualifierFullTime(new Date()),
      QUALIFIER_FULL_TIME_SKIP_REASON,
    );
    const winnerPage = page;
    const loserPage = await openUserPage();
    const supporterPage = await openUserPage();
    const winner = await registerOwnerProduct(winnerPage);
    const loser = await registerOwnerProduct(loserPage);
    const supporter = await registerSupporter(supporterPage);

    const { businessDate } = await createEndedQualifier({
      winnerHandle: winner.handle,
      loserHandle: loser.handle,
      supporterHandle: supporter.handle,
    });
    const listed = await createListedProducts({ matchDate: businessDate });
    await triggerScheduled({
      worker: 'api',
      businessDate,
      businessTime: QUALIFIER_FULL_TIME,
    });
    await waitForDirectorySearchResult(supporterPage, winner.name);

    await openDirectory(supporterPage);
    await searchDirectory(supporterPage, winner.name);
    await expect(directoryItemOf(supporterPage, winner.name)).toBeVisible();
    await expect(
      resultCountOf(supporterPage, SINGLE_RESULT_PATTERN),
    ).toBeVisible();

    await chooseDirectoryCategory(supporterPage, PRODUCT_CATEGORY_OTHER_NAME);
    await expect(supporterPage).toHaveURL(
      () =>
        searchParamOf(supporterPage, 'category') ===
          PRODUCT_CATEGORY_OTHER_HANDLE &&
        searchParamOf(supporterPage, 'q') === winner.name,
    );
    await expect(directoryItemOf(supporterPage, winner.name)).toBeVisible();
    await expect(
      resultCountOf(supporterPage, SINGLE_RESULT_PATTERN),
    ).toBeVisible();

    // 当日の掲載は勝ったプロダクト(Upvote1票)と後から作った不戦勝の21件(0票)を含む。同じ実施日はプロダクトのIDの降順のため、既定の新しい順の1ページ目は不戦勝の項目だけになり、Upvote数が多い順では勝ったプロダクトが不戦勝のどの項目よりも前に並ぶ
    await openDirectory(
      supporterPage,
      directoryPeriodPath({ from: businessDate, to: businessDate }),
    );
    await expect(
      resultCountOf(supporterPage, FIRST_PAGE_COUNT_PATTERN),
    ).toBeVisible();
    const listedNames = new Set(listed.products.map(({ name }) => name));
    const newestNames = await readDirectoryItemNames(supporterPage);
    expect(newestNames.filter((name) => !listedNames.has(name))).toEqual([]);

    await chooseDirectorySort(supporterPage, 'upvotes');
    await expect(directoryItemOf(supporterPage, winner.name)).toBeVisible();
    await expect(
      resultCountOf(supporterPage, FIRST_PAGE_COUNT_PATTERN),
    ).toBeVisible();
    const firstPageNames = await readDirectoryItemNames(supporterPage);
    expect(firstPageNames).toHaveLength(DIRECTORY_PAGE_SIZE);
    const winnerIndex = firstPageNames.indexOf(winner.name);
    expect(winnerIndex).toBeGreaterThanOrEqual(0);
    const firstListedIndex = firstPageNames.findIndex((name) =>
      listedNames.has(name),
    );
    if (firstListedIndex >= 0) {
      expect(winnerIndex).toBeLessThan(firstListedIndex);
    }

    await moveToDirectoryPage(supporterPage, 2);
    await expect(supporterPage).toHaveURL(
      () =>
        searchParamOf(supporterPage, 'sort') === 'upvotes' &&
        searchParamOf(supporterPage, 'from') === businessDate &&
        searchParamOf(supporterPage, 'to') === businessDate,
    );
    await expect(
      resultCountOf(supporterPage, SECOND_PAGE_COUNT_PATTERN),
    ).toBeVisible();
    const secondPageNames = await readDirectoryItemNames(supporterPage);
    expect(secondPageNames.length).toBeGreaterThan(0);
    expect(
      secondPageNames.filter((name) => firstPageNames.includes(name)),
    ).toEqual([]);

    await waitForDirectorySearchResult(supporterPage, winner.name);
    await openProductFromDirectory(supporterPage, winner.name, winner.handle);
    const winnerHistory = await expectQualifierHistory(
      supporterPage,
      'won',
      [1, 0],
    );
    await expectSupporters(winnerHistory, [supporter.account.nickname]);

    await expectProductNotFound(supporterPage, loser.handle);
    await expectUnlistedOwnProductPage(loserPage, loser.name, loser.handle);
    await expectQualifierHistory(loserPage, 'lost', [0, 1]);

    const changedHandle = createProductHandle();
    const handleForm = await openProductEditor(winnerPage, winner.name);
    await fillProductHandle(handleForm, changedHandle);
    await saveProductChanges(winnerPage, handleForm);
    const redirect = await requestWithoutFollowing(
      supporterPage,
      productPagePath(winner.handle),
    );
    expect(redirect.status).toBe(REDIRECT_STATUS);
    expect(new URL(redirect.location ?? '', supporterPage.url()).pathname).toBe(
      productPagePath(changedHandle),
    );
    await supporterPage.goto(productPagePath(winner.handle));
    await expect(supporterPage).toHaveURL(
      (url) => url.pathname === productPagePath(changedHandle),
    );
    await expect(
      supporterPage.getByRole('heading', {
        level: 1,
        name: winner.name,
        exact: true,
      }),
    ).toBeVisible();
  });
});
