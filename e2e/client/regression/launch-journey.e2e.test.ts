import type { BrowserContext, Page } from '@playwright/test';

import { ADMIN_FLOW_TIMEOUT_MS } from '../../support/admin-bootstrap.ts';
import { assumeDistinctClientIp } from '../../support/client-ip.ts';
import {
  isNearBusinessDayBoundary,
  triggerScheduled,
} from '../../support/scheduled-trigger.ts';
import { resolveE2ETargets } from '../../support/targets.ts';
import {
  closeWeekTournamentEntry,
  createWeekTournamentEntrants,
  endWeekFinal,
  readWeekFinal,
  runWeekEveningJobs,
  startWeekFinalToday,
} from '../../support/week-tournament-fixtures.ts';
import { MAIL_FLOW_TIMEOUT_MS } from '../auth/account-steps.ts';
import { expect, test as base } from '../auth/auth-test.ts';
import { CHECKOUT_FLOW_TIMEOUT_MS } from '../checkout-steps.ts';
import {
  DIRECTORY_INDEX_TIMEOUT_MS,
  expectQualifierHistory,
  expectSupporters,
  openProductFromDirectory,
  waitForDirectorySearchResult,
} from '../directory-steps.ts';
import {
  createMatchCategory,
  expectUpvoteState,
  isNearQualifierFullTime,
  type MatchProductNames,
  moveLaunchesToDate,
  openTopPageMatch,
  QUALIFIER_FULL_TIME_SKIP_REASON,
  startQualifiers,
  todayBusinessDate,
  upvoteEntry,
} from '../match-steps.ts';
import { PRODUCT_FLOW_TIMEOUT_MS } from '../product-steps.ts';
import {
  expectLiveFinalOnBracket,
  expectWeekTrophy,
  openBracketFromTopPageFinal,
  openProductPage,
} from '../week-tournament-steps.ts';
import {
  BUSINESS_DAY_BOUNDARY_SKIP_REASON,
  endQualifierMatch,
  expectNoA11yViolations,
  registerJourneyOwner,
  enterWeekTournament,
  readJourneyUserHandle,
  registerJourneyUser,
  skipPart,
} from './launch-journey-steps.ts';

interface BrowserPageFixtures {
  readonly openUserPage: () => Promise<Page>;
  readonly openAdminPage: () => Promise<Page>;
}

const baseURLOf = (name: 'client' | 'admin'): string => {
  const target = resolveE2ETargets(process.env).find(
    (candidate) => candidate.name === name,
  );
  if (target === undefined) {
    throw new Error(`${name}のE2E対象が定義されていません`);
  }
  return target.baseURL;
};

// 利用者3人と管理者を並べる流れのため、呼ぶたびに別の接続元を名乗る別のブラウザの文脈で開く。開いた文脈はテストの終わりに閉じる
const test = base.extend<BrowserPageFixtures>({
  openUserPage: async ({ browser }, use) => {
    const contexts: BrowserContext[] = [];
    try {
      await use(async () => {
        const baseURL = baseURLOf('client');
        const context = await browser.newContext({ baseURL });
        contexts.push(context);
        await assumeDistinctClientIp(context, baseURL);
        return context.newPage();
      });
    } finally {
      await Promise.all(contexts.map((context) => context.close()));
    }
  },
  openAdminPage: async ({ browser }, use) => {
    const contexts: BrowserContext[] = [];
    try {
      await use(async () => {
        const baseURL = baseURLOf('admin');
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

// 管理者の用意・3人の登録・2件のプロダクトの登録・ディレクトリの索引の待ちに、参加費の決済とWeekトーナメントの補助の操作の分を足す
const FIXTURE_FLOW_TIMEOUT_MS = 240_000;

const SCAN_AND_STEP_MARGIN_MS = 120_000;

test.describe.configure({
  timeout:
    ADMIN_FLOW_TIMEOUT_MS +
    PRODUCT_FLOW_TIMEOUT_MS * 2 +
    MAIL_FLOW_TIMEOUT_MS +
    DIRECTORY_INDEX_TIMEOUT_MS +
    CHECKOUT_FLOW_TIMEOUT_MS +
    FIXTURE_FLOW_TIMEOUT_MS +
    SCAN_AND_STEP_MARGIN_MS,
});

const QUALIFIER_FULL_TIME = '23:40';

// 乱数の接尾辞のデータだけを作り前回の実行のデータを消さないため、繰り返しても結果は変わらない。ローカルのメール受信箱とD1を使うため、@smokeタグを付けない
test.describe('公開までの流れ', () => {
  test('3人の登録とメールの確認から2人のプロダクトの登録・予選の開始・3人目のUpvote・23:40の確定でディレクトリとプロダクト詳細に勝利が出て、Weekトーナメントの参加・組み合わせ・勝敗の確定まで進み、各画面でアクセシビリティの違反が無い', async ({
    page,
    openUserPage,
    openAdminPage,
  }) => {
    test.skip(
      isNearQualifierFullTime(new Date()),
      QUALIFIER_FULL_TIME_SKIP_REASON,
    );
    const today = todayBusinessDate();

    const adminPage = await openAdminPage();
    const categoryName = await createMatchCategory(adminPage);
    await adminPage.context().close();

    const ownerPage = page;
    const rivalPage = await openUserPage();
    const supporterPage = await openUserPage();
    const owner = await registerJourneyOwner(ownerPage, categoryName, {
      scanRegisterPage: true,
    });
    const rival = await registerJourneyOwner(rivalPage, categoryName);
    const supporter = await registerJourneyUser(supporterPage);

    await moveLaunchesToDate(
      [owner.product.handle, rival.product.handle],
      today,
    );
    await startQualifiers(today);

    const names: MatchProductNames = [owner.product.name, rival.product.name];
    const card = await openTopPageMatch(supporterPage, names);
    await expectUpvoteState(card, owner.product.name, {
      count: 0,
      upvoted: false,
    });
    await upvoteEntry(supporterPage, card, owner.product.name);
    await expectUpvoteState(card, owner.product.name, {
      count: 1,
      upvoted: true,
    });
    await expectNoA11yViolations(supporterPage, '/', 'with-data');

    await endQualifierMatch([owner.product.handle, rival.product.handle]);
    await triggerScheduled({
      worker: 'api',
      businessDate: today,
      businessTime: QUALIFIER_FULL_TIME,
    });
    await waitForDirectorySearchResult(supporterPage, owner.product.name);
    await expectNoA11yViolations(supporterPage, '/p/', 'with-data');

    await openProductFromDirectory(
      supporterPage,
      owner.product.name,
      owner.product.handle,
    );
    const history = await expectQualifierHistory(supporterPage, 'won', [1, 0]);
    await expectSupporters(history, [supporter.nickname]);
    await expectNoA11yViolations(supporterPage, '/p/$handle', 'with-data');

    if (isNearBusinessDayBoundary(new Date())) {
      skipPart(BUSINESS_DAY_BOUNDARY_SKIP_REASON);
      return;
    }
    const fixture = await createWeekTournamentEntrants({
      openOwnerHandle: await readJourneyUserHandle(ownerPage, owner.account),
    });
    await openProductPage(ownerPage, fixture.open);
    await expectNoA11yViolations(ownerPage, '/p/$handle', 'week-entry');
    await enterWeekTournament(ownerPage, fixture);

    await closeWeekTournamentEntry(fixture);
    await runWeekEveningJobs();
    const scheduled = await readWeekFinal(fixture);
    expect(new Set(scheduled?.productIds)).toStrictEqual(
      new Set([fixture.open.productId, fixture.ultras.productId]),
    );
    const final = await startWeekFinalToday(fixture);
    await openBracketFromTopPageFinal(ownerPage, fixture);
    await expectNoA11yViolations(
      ownerPage,
      '/tournaments/week/$week',
      'with-data',
    );
    await expectLiveFinalOnBracket(ownerPage, fixture);

    await endWeekFinal(final, fixture.open);
    await runWeekEveningJobs({ awaitDecidedFinal: final });
    await expectWeekTrophy(ownerPage, fixture, fixture.open);
    await expectNoA11yViolations(ownerPage, '/p/$handle', 'week-trophy');
  });
});
