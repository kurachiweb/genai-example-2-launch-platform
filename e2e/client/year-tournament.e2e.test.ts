import {
  businessDateOf,
  isNearBusinessDayBoundary,
} from '../support/scheduled-trigger.ts';
import {
  closeYearTournamentEntry,
  createYearTournamentEntrants,
  endYearFinal,
  entitleOpenYearEntryWithoutPayment,
  readYearFinal,
  readYearTournamentState,
  runYearEveningJobs,
  startYearFinalToday,
} from '../support/year-tournament-fixtures.ts';
import { expect, test } from './auth/auth-test.ts';

// ローカルのD1の操作(1回数秒)を十数回と、確定のイベントの処理の待ち(最大90秒)を含む
const FIXTURE_FLOW_TIMEOUT_MS = 240_000;

test.describe.configure({ timeout: FIXTURE_FLOW_TIMEOUT_MS });

const BUSINESS_DAY_BOUNDARY_SKIP_REASON =
  '業務日付の境界の直前は、決勝を今日へ移した後に業務日付が変わり得るため、YearトーナメントのE2Eを飛ばします';

test.describe('Yearトーナメントの補助', () => {
  test('補助を順に使うと、ローカルのD1に参加の枠・組み合わせ・開始済みの決勝ができ、決勝の終了の後の23:40・23:45のジョブと確定のイベントで受賞が記録される', async () => {
    test.skip(
      isNearBusinessDayBoundary(new Date()),
      BUSINESS_DAY_BOUNDARY_SKIP_REASON,
    );
    const fixture = await createYearTournamentEntrants();
    expect(await readYearTournamentState(fixture)).toStrictEqual({
      status: 'open',
      outcome: null,
      bracketId: null,
      participantCount: null,
      firstRoundDate: null,
      championProductId: null,
    });

    await entitleOpenYearEntryWithoutPayment(fixture);
    await closeYearTournamentEntry(fixture);
    await runYearEveningJobs();
    expect(await readYearTournamentState(fixture)).toMatchObject({
      status: 'in_progress',
      bracketId: expect.any(String),
      participantCount: 2,
    });
    const scheduled = await readYearFinal(fixture);
    expect(scheduled).toMatchObject({
      round: 1,
      bracketStatus: 'scheduled',
      startedAt: null,
      decidedAt: null,
    });
    expect(new Set(scheduled?.productIds)).toStrictEqual(
      new Set([fixture.open.productId, fixture.ultras.productId]),
    );

    const final = await startYearFinalToday(fixture);
    const today = businessDateOf(new Date());
    expect(final).toMatchObject({
      matchId: scheduled?.matchId,
      matchDate: today,
      startedAt: expect.any(Date),
      decidedAt: null,
    });
    expect(await readYearTournamentState(fixture)).toMatchObject({
      firstRoundDate: today,
    });

    await endYearFinal(final, fixture.open);
    await runYearEveningJobs({ awaitDecidedFinal: final });
    expect(await readYearTournamentState(fixture)).toMatchObject({
      status: 'finished',
      outcome: 'awarded',
      championProductId: fixture.open.productId,
    });
  });
});
