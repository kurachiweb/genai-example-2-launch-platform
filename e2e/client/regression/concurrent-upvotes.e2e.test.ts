import type { APIRequestContext, Browser, Page } from '@playwright/test';

import { ADMIN_FLOW_TIMEOUT_MS } from '../../support/admin-bootstrap.ts';
import { assumeDistinctClientIp } from '../../support/client-ip.ts';
import { createBulkUsers, signedInRequest } from '../../support/bulk-users.ts';
import { resolveE2ETargets } from '../../support/targets.ts';
import {
  createTestAccount,
  MAIL_FLOW_TIMEOUT_MS,
} from '../auth/account-steps.ts';
import { expect, test as clientTest } from '../auth/auth-test.ts';
import {
  createMatchCategory,
  expectUpvoteState,
  isNearQualifierFullTime,
  matchCardOf,
  type MatchProductNames,
  moveLaunchesToDate,
  QUALIFIER_FULL_TIME_SKIP_REASON,
  startQualifiers,
  todayBusinessDate,
} from '../match-steps.ts';
import {
  createProductInput,
  fillProduct,
  openProductRegistration,
  PRODUCT_FLOW_TIMEOUT_MS,
  type ProductInput,
  registerProduct,
  upcomingLaunchDates,
} from '../product-steps.ts';
import { registerVerifiedAccount } from '../profile-steps.ts';
import {
  entryOfProduct,
  formatUpvoteReport,
  readQualifierMatch,
  tallyUpvotes,
  upvoteConcurrently,
} from './concurrent-upvotes-steps.ts';

const CONCURRENT_USER_COUNT = 100;

const TOP_PAGE_PATH = '/';

// ログインはパスワードのハッシュの照合が重いため、検証の対象の同時のUpvoteとは別に、一定の数ずつ進める
const LOGIN_BATCH_SIZE = 20;

// 管理者の用意・2人のプロダクトの登録・100人の1人目の登録に、100人のログインと同時のUpvoteの待ちを足す
const BULK_PHASE_TIMEOUT_MS = 300_000;

interface PageFixtures {
  readonly withPage: <T>(
    target: 'client' | 'admin',
    run: (page: Page) => Promise<T>,
  ) => Promise<T>;
}

const baseURLOf = (target: 'client' | 'admin'): string => {
  const found = resolveE2ETargets(process.env).find(
    ({ name }) => name === target,
  );
  if (found === undefined) {
    throw new Error(`E2E対象${target}が定義されていません`);
  }
  return found.baseURL;
};

// メモリの逼迫を避けるため、ブラウザの文脈は使い終えたらすぐ閉じる
async function runInContext<T>(
  browser: Browser,
  baseURL: string,
  run: (page: Page) => Promise<T>,
): Promise<T> {
  const context = await browser.newContext({ baseURL });
  try {
    await assumeDistinctClientIp(context, baseURL);
    return await run(await context.newPage());
  } finally {
    await context.close();
  }
}

// カテゴリの作成は管理画面で行い、利用者の操作は別の接続元の利用者側の文脈で行う。利用者側のプロジェクトの中で管理者側の画面を開くため、管理者側のオリジンを基準にした文脈を開く
const test = clientTest.extend<PageFixtures>({
  withPage: async ({ browser }, use) => {
    await use((target, run) => runInContext(browser, baseURLOf(target), run));
  },
});

test.describe.configure({
  timeout:
    ADMIN_FLOW_TIMEOUT_MS +
    PRODUCT_FLOW_TIMEOUT_MS * 2 +
    MAIL_FLOW_TIMEOUT_MS +
    BULK_PHASE_TIMEOUT_MS,
});

async function registerOwnerProduct(
  page: Page,
  categoryName: string,
): Promise<ProductInput> {
  await registerVerifiedAccount(page, createTestAccount());
  const input = { ...createProductInput(), categoryName };
  const [launchDate] = upcomingLaunchDates();
  const form = await openProductRegistration(page);
  await fillProduct(page, form, input, launchDate);
  await registerProduct(page, form);
  return input;
}

async function signInInBatches(
  users: Awaited<ReturnType<typeof createBulkUsers>>,
  baseURL: string,
): Promise<readonly APIRequestContext[]> {
  const contexts: APIRequestContext[] = [];
  try {
    for (let start = 0; start < users.length; start += LOGIN_BATCH_SIZE) {
      const batch = users.slice(start, start + LOGIN_BATCH_SIZE);
      contexts.push(
        ...(await Promise.all(
          batch.map((user) => signedInRequest(user, baseURL)),
        )),
      );
    }
    return contexts;
  } catch (error) {
    await Promise.all(contexts.map((context) => context.dispose()));
    throw error;
  }
}

test.describe('同時のUpvote', () => {
  test('100人のログイン済みの利用者が同じマッチの同じ側へ同時にUpvoteしても、5xxが0件で、その側の数え上げが100になる', async ({
    page,
    withPage,
  }, testInfo) => {
    test.skip(
      isNearQualifierFullTime(new Date()),
      QUALIFIER_FULL_TIME_SKIP_REASON,
    );
    const clientBaseURL = baseURLOf('client');
    const categoryName = await withPage('admin', createMatchCategory);
    const own = await withPage('client', (ownerPage) =>
      registerOwnerProduct(ownerPage, categoryName),
    );
    const rival = await withPage('client', (rivalPage) =>
      registerOwnerProduct(rivalPage, categoryName),
    );
    await moveLaunchesToDate([own.handle, rival.handle], todayBusinessDate());
    await startQualifiers(todayBusinessDate());
    const names: MatchProductNames = [own.name, rival.name];

    const users = await createBulkUsers(page, CONCURRENT_USER_COUNT);
    const [viewer, ...others] = await signInInBatches(users, clientBaseURL);
    if (viewer === undefined) {
      throw new Error('ログイン済みの利用者の文脈がありません');
    }
    const contexts = [viewer, ...others];
    try {
      const before = await readQualifierMatch(viewer, own.handle);
      const target = entryOfProduct(before, own.handle);
      const other = entryOfProduct(before, rival.handle);
      expect(
        [target.upvoteCount, other.upvoteCount],
        '同時のUpvoteの前に両方の側が0票である',
      ).toEqual([0, 0]);

      const { observations, elapsedMs } = await upvoteConcurrently(contexts, {
        matchId: before.id,
        entryId: target.id,
      });

      const after = await readQualifierMatch(viewer, own.handle);
      const counts = {
        target: entryOfProduct(after, own.handle).upvoteCount,
        other: entryOfProduct(after, rival.handle).upvoteCount,
      };
      const tally = tallyUpvotes(observations, target.id);
      const report = formatUpvoteReport(tally, { elapsedMs, counts });
      await testInfo.attach('concurrent-upvotes-report', {
        body: report,
        contentType: 'text/plain',
      });
      testInfo.annotations.push({
        type: 'concurrent-upvotes',
        description: report.replaceAll('\n', ' / '),
      });

      expect(tally.total, report).toBe(CONCURRENT_USER_COUNT);
      expect(tally.serverErrorCount, report).toBe(0);
      expect(counts, report).toEqual({
        target: CONCURRENT_USER_COUNT,
        other: 0,
      });
      expect(tally.acceptedCount, report).toBe(CONCURRENT_USER_COUNT);

      await withPage('client', async (viewerPage) => {
        await viewerPage.goto(TOP_PAGE_PATH);
        const card = matchCardOf(viewerPage, names);
        await expect(card).toBeVisible();
        await expectUpvoteState(card, own.name, {
          count: CONCURRENT_USER_COUNT,
          upvoted: false,
        });
        await expectUpvoteState(card, rival.name, { count: 0, upvoted: false });
      });
    } finally {
      await Promise.all(contexts.map((context) => context.dispose()));
    }
  });
});
