import {
  businessDateOf,
  isNearBusinessDayBoundary,
} from '../support/scheduled-trigger.ts';
import {
  closeWeekTournamentEntry,
  createWeekTournamentEntrants,
  endWeekFinal,
  entitleOpenEntryWithoutPayment,
  readWeekFinal,
  readWeekTournamentState,
  runWeekEveningJobs,
  startWeekFinalToday,
} from '../support/week-tournament-fixtures.ts';
import { expect, test } from './auth/auth-test.ts';
import {
  CHECKOUT_FLOW_TIMEOUT_MS,
  confirmPayment,
  preparePaymentWithTestCard,
} from './checkout-steps.ts';
import {
  expectLiveFinalOnBracket,
  expectWeekEntryCompletedReturn,
  expectWeekEntryEntitled,
  expectWeekTrophy,
  openBracketFromTopPageFinal,
  openProductPage,
  registerWeekEntrantOwner,
  startWeekEntryCheckout,
  WEEK_ENTRY_CHECKOUT_SKIP_REASON,
} from './week-tournament-steps.ts';

// ローカルのD1の操作(1回数秒)を十数回と、確定のイベントの処理の待ち(最大90秒)を含む
const FIXTURE_FLOW_TIMEOUT_MS = 240_000;

test.describe.configure({ timeout: FIXTURE_FLOW_TIMEOUT_MS });

const BUSINESS_DAY_BOUNDARY_SKIP_REASON =
  '業務日付の境界の直前は、決勝を今日へ移した後に業務日付が変わり得るため、WeekトーナメントのE2Eを飛ばします';

test.describe('Weekトーナメントの補助', () => {
  test('補助を順に使うと、ローカルのD1に参加の枠・組み合わせ・開始済みの決勝ができ、決勝の終了の後の23:40・23:45のジョブと確定のイベントで受賞が記録される', async () => {
    test.skip(
      isNearBusinessDayBoundary(new Date()),
      BUSINESS_DAY_BOUNDARY_SKIP_REASON,
    );
    const fixture = await createWeekTournamentEntrants();
    expect(await readWeekTournamentState(fixture)).toStrictEqual({
      status: 'open',
      outcome: null,
      bracketId: null,
      championProductId: null,
    });

    await entitleOpenEntryWithoutPayment(fixture);
    await closeWeekTournamentEntry(fixture);
    await runWeekEveningJobs();
    expect(await readWeekTournamentState(fixture)).toMatchObject({
      status: 'in_progress',
      bracketId: expect.any(String),
    });
    const scheduled = await readWeekFinal(fixture);
    expect(scheduled).toMatchObject({
      round: 1,
      bracketStatus: 'scheduled',
      startedAt: null,
      decidedAt: null,
    });
    expect(new Set(scheduled?.productIds)).toStrictEqual(
      new Set([fixture.open.productId, fixture.ultras.productId]),
    );

    const final = await startWeekFinalToday(fixture);
    expect(final).toMatchObject({
      matchId: scheduled?.matchId,
      matchDate: businessDateOf(new Date()),
      startedAt: expect.any(Date),
      decidedAt: null,
    });

    await endWeekFinal(final, fixture.open);
    await runWeekEveningJobs({ awaitDecidedFinal: final });
    expect(await readWeekTournamentState(fixture)).toMatchObject({
      status: 'finished',
      outcome: 'awarded',
      championProductId: fixture.open.productId,
    });
  });
});

// 参加費の決済はStripeのsandboxに購入を作り、決済の通知はstripe listenの転送でイベントサーバーへ届く
test.describe('Weekトーナメントの参加費・組み合わせ・受賞(利用者側。実行のたびにsandboxに決済が1つ残る)', () => {
  test('受付中の枠の投稿者がプロダクト詳細ページから参加費をテストカードで支払うと参加資格を得て、組み合わせ決定の後にトップページの決勝の区画とブラケットのページに決勝が出て、決勝の確定の後にプロダクト詳細ページのトロフィーに受賞が出る', async ({
    page,
  }) => {
    test.setTimeout(CHECKOUT_FLOW_TIMEOUT_MS + FIXTURE_FLOW_TIMEOUT_MS);
    test.skip(
      isNearBusinessDayBoundary(new Date()),
      BUSINESS_DAY_BOUNDARY_SKIP_REASON,
    );
    const owner = await registerWeekEntrantOwner(page);
    const fixture = await createWeekTournamentEntrants({
      openOwnerHandle: owner.handle,
    });

    await openProductPage(page, fixture.open);
    const start = await startWeekEntryCheckout(page);
    test.skip(
      start.kind === 'payments_unavailable',
      WEEK_ENTRY_CHECKOUT_SKIP_REASON,
    );
    await preparePaymentWithTestCard(page);
    await confirmPayment(page);
    await expectWeekEntryCompletedReturn(page);
    await expectWeekEntryEntitled(page, fixture.open);

    await closeWeekTournamentEntry(fixture);
    await runWeekEveningJobs();
    const scheduled = await readWeekFinal(fixture);
    expect(new Set(scheduled?.productIds)).toStrictEqual(
      new Set([fixture.open.productId, fixture.ultras.productId]),
    );
    const final = await startWeekFinalToday(fixture);
    await openBracketFromTopPageFinal(page, fixture);
    await expectLiveFinalOnBracket(page, fixture);

    await endWeekFinal(final, fixture.open);
    await runWeekEveningJobs({ awaitDecidedFinal: final });
    await expectWeekTrophy(page, fixture, fixture.open);
  });
});
