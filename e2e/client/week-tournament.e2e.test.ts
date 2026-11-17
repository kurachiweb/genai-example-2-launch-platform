import { expect, test } from '@playwright/test';

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

// ローカルのD1の操作(1回数秒)を十数回と、確定のイベントの処理の待ち(最大90秒)を含む
test.describe.configure({ timeout: 240_000 });

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
