import type { Event } from '@sentry/cloudflare';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import type { LogObject } from '../../core/logging/log-record.ts';
import { addBusinessDays } from '../../core/time/business-time.ts';
import {
  insertUser,
  productIdOf,
} from '../product/testing/product-fixtures.ts';
import { bracketIdOf } from '../tournament/testing/bracket-fixtures.ts';
import {
  installRecordingSentry,
  recordLogs,
  resetObservability,
} from '../tournament/testing/observability-fixtures.ts';
import {
  at,
  settle,
  unlink,
} from '../tournament/testing/progression-fixtures.ts';
import {
  advanceAndApply,
  createService,
  PROGRESSION_CATEGORY,
  RecordingYearNotificationPublisher,
  seedYear,
  YEAR_TOURNAMENT_ID,
  yearOf,
} from './testing/year-progression-fixtures.ts';
import {
  clearYearTournamentTables,
  defaultScheduleOf,
  insertYearTournaments,
  YEAR,
  YEAR_SCHEDULE,
  yearEntryIdOf,
  yearTournamentIdOf,
} from './testing/year-tournament-fixtures.ts';

const FINAL_DATE = YEAR_SCHEDULE.finalDate;

const FINAL_ADVANCE_AT = at(FINAL_DATE, 23, 45);

const RETRIED_AT = at(FINAL_DATE, 23, 50);

const NEXT_YEAR = YEAR + 1;

async function seedFinal(): Promise<string> {
  const [final] = await seedYear({
    index: 1,
    entries: [1, 2],
    firstMatchIds: 1,
  });
  if (final === undefined) {
    throw new Error('決勝の予定がありません');
  }
  return final;
}

let logs: LogObject[];

beforeEach(async () => {
  await clearYearTournamentTables();
  await insertUser(1);
  logs = recordLogs();
});

afterEach(() => {
  resetObservability();
});

describe('YearTournamentProgressionService.applyResult(終了と賞)', () => {
  test('決勝の勝者が確定すると、受賞を発行した後に終了を1回だけ記録し、決勝の結果を発行して予告は発行しない', async () => {
    const final = await seedFinal();
    await settle(final, ['lost', 'won']);
    const harness = createService();
    const tournament = await yearOf(harness.store);

    const result = await harness.service.advance(
      YEAR_TOURNAMENT_ID,
      FINAL_ADVANCE_AT,
    );
    if (result === undefined) {
      throw new Error('進行の結果がありません');
    }
    await harness.service.applyResult(tournament, result, FINAL_ADVANCE_AT);
    await harness.service.applyResult(tournament, result, RETRIED_AT);

    expect(result).toEqual({
      kind: 'finished',
      bracketId: bracketIdOf(1),
      championRef: yearEntryIdOf(2),
      newlyFinished: true,
      decidedMatchIds: [final],
    });
    expect(harness.notifications.statusesAtAward[0]).toBe('in_progress');
    expect(harness.store.recordedFinishes).toBe(1);
    expect(await yearOf(harness.store)).toMatchObject({
      status: 'finished',
      outcome: 'awarded',
      championEntryId: yearEntryIdOf(2),
      awardedAt: FINAL_ADVANCE_AT,
    });
    expect(harness.notifications.recordedAwards()).toEqual([
      { year: YEAR, productId: productIdOf(2), at: FINAL_ADVANCE_AT },
    ]);
    expect(harness.notifications.rounds).toEqual([
      { decidedMatchIds: [final], previewMatchIds: [], at: FINAL_ADVANCE_AT },
      { decidedMatchIds: [final], previewMatchIds: [], at: RETRIED_AT },
    ]);
    expect(
      await harness.service.advance(YEAR_TOURNAMENT_ID, RETRIED_AT),
    ).toBeUndefined();
  });

  test('同時に進めても終了の記録は1回で、受賞の発行は重複を除いて1件になる', async () => {
    const final = await seedFinal();
    await settle(final, ['won', 'lost']);
    const harness = createService();
    const tournament = await yearOf(harness.store);

    await Promise.all(
      [0, 1, 2].map(async () => {
        const result = await harness.service.advance(
          YEAR_TOURNAMENT_ID,
          FINAL_ADVANCE_AT,
        );
        if (result !== undefined) {
          await harness.service.applyResult(
            tournament,
            result,
            FINAL_ADVANCE_AT,
          );
        }
      }),
    );

    expect(harness.store.recordedFinishes).toBe(1);
    expect(harness.notifications.recordedAwards()).toEqual([
      { year: YEAR, productId: productIdOf(1), at: FINAL_ADVANCE_AT },
    ]);
    expect(await yearOf(harness.store)).toMatchObject({
      outcome: 'awarded',
      championEntryId: yearEntryIdOf(1),
    });
  });

  test('次ラウンドに残る参加者が1になると、残った枠の受賞を発行して終了を記録する', async () => {
    const [first, second] = await seedYear({
      index: 1,
      entries: [1, 2, 3, 4],
      firstMatchIds: 1,
    });
    if (first === undefined || second === undefined) {
      throw new Error('1回戦の予定がありません');
    }
    await settle(first, ['lost', 'lost'], 'no_votes');
    await settle(second, ['won', 'lost']);
    const harness = createService();
    const advancedAt = at(addBusinessDays(FINAL_DATE, -1), 23, 45);

    const result = await advanceAndApply(harness, advancedAt);

    expect(result).toMatchObject({
      kind: 'finished',
      championRef: yearEntryIdOf(3),
    });
    expect(await yearOf(harness.store)).toMatchObject({
      status: 'finished',
      outcome: 'awarded',
      championEntryId: yearEntryIdOf(3),
      awardedAt: advancedAt,
    });
    expect(harness.notifications.recordedAwards()).toEqual([
      { year: YEAR, productId: productIdOf(3), at: advancedAt },
    ]);
    expect(harness.notifications.rounds).toEqual([
      {
        decidedMatchIds: [first, second],
        previewMatchIds: [],
        at: advancedAt,
      },
    ]);
  });

  test('受賞の発行に失敗すると終了を記録せず年を進行中のまま残し、再実行で発行と記録が1回ずつになる', async () => {
    const final = await seedFinal();
    await settle(final, ['lost', 'won']);
    const notifications = new RecordingYearNotificationPublisher(0, 1);
    const harness = createService({ notifications });

    await expect(advanceAndApply(harness, FINAL_ADVANCE_AT)).rejects.toThrow(
      '受賞の発行の一時的な失敗',
    );
    expect(await yearOf(harness.store)).toMatchObject({
      status: 'in_progress',
      outcome: null,
      championEntryId: null,
      awardedAt: null,
    });
    expect(harness.store.recordedFinishes).toBe(0);

    await advanceAndApply(harness, RETRIED_AT);

    expect(harness.store.recordedFinishes).toBe(1);
    expect(notifications.awards).toEqual([
      { year: YEAR, productId: productIdOf(2), at: RETRIED_AT },
    ]);
    expect(await yearOf(harness.store)).toMatchObject({
      status: 'finished',
      outcome: 'awarded',
      championEntryId: yearEntryIdOf(2),
      awardedAt: RETRIED_AT,
    });
  });

  test('結果の発行に失敗すると受賞を発行せず年を進行中のまま残し、再実行で受賞の発行と記録に進む', async () => {
    const final = await seedFinal();
    await settle(final, ['lost', 'won']);
    const notifications = new RecordingYearNotificationPublisher(1, 0);
    const harness = createService({ notifications });

    await expect(advanceAndApply(harness, FINAL_ADVANCE_AT)).rejects.toThrow(
      '結果と予告の発行の一時的な失敗',
    );
    expect(notifications.awards).toEqual([]);
    expect(await yearOf(harness.store)).toMatchObject({
      status: 'in_progress',
    });

    await advanceAndApply(harness, RETRIED_AT);

    expect(harness.store.recordedFinishes).toBe(1);
    expect(notifications.recordedAwards()).toEqual([
      { year: YEAR, productId: productIdOf(2), at: RETRIED_AT },
    ]);
    expect(notifications.rounds).toEqual([
      { decidedMatchIds: [final], previewMatchIds: [], at: RETRIED_AT },
    ]);
  });

  test('決勝が両者敗北なら受賞なしで記録し、受賞を発行せず結果だけを発行する', async () => {
    const final = await seedFinal();
    await settle(final, ['lost', 'lost'], 'no_votes');
    const harness = createService();

    await advanceAndApply(harness, FINAL_ADVANCE_AT);

    expect(await yearOf(harness.store)).toMatchObject({
      status: 'finished',
      outcome: 'no_award',
      championEntryId: null,
      awardedAt: null,
    });
    expect(harness.store.recordedFinishes).toBe(1);
    expect(harness.notifications.awards).toEqual([]);
    expect(harness.notifications.rounds).toEqual([
      { decidedMatchIds: [final], previewMatchIds: [], at: FINAL_ADVANCE_AT },
    ]);
  });

  test('決勝の確定の後に紐付けを解除した優勝は受賞を記録し、受賞を発行しない', async () => {
    const final = await seedFinal();
    await settle(final, ['lost', 'won']);
    await unlink([2]);
    const harness = createService();
    await harness.entries.unlinkOrDeleteByProduct(productIdOf(2));

    await advanceAndApply(harness, FINAL_ADVANCE_AT);

    expect(await yearOf(harness.store)).toMatchObject({
      outcome: 'awarded',
      championEntryId: yearEntryIdOf(2),
    });
    expect(harness.notifications.awards).toEqual([]);
    expect(harness.notifications.rounds).toHaveLength(1);
    expect(
      logs.filter(({ category }) => category === PROGRESSION_CATEGORY),
    ).toEqual([
      expect.objectContaining({
        level: 'info',
        yearTournamentId: YEAR_TOURNAMENT_ID,
        entryId: yearEntryIdOf(2),
      }),
    ]);
  });
});

describe('YearTournamentProgressionService.advanceAll', () => {
  let events: Event[];

  beforeEach(() => {
    events = installRecordingSentry();
  });

  test('進行中の全ての年を進め、1つの失敗で他を止めずに失敗した年の一覧を返す', async () => {
    const [nextFinal] = await seedYear({
      index: 2,
      year: NEXT_YEAR,
      entries: [3, 4],
      firstMatchIds: 51,
    });
    const final = await seedFinal();
    if (nextFinal === undefined) {
      throw new Error('決勝の予定がありません');
    }
    await settle(nextFinal, ['won', 'lost']);
    await settle(final, ['lost', 'won']);
    await insertYearTournaments([
      {
        index: 3,
        year: YEAR - 1,
        columns: {
          status: 'finished',
          outcome: 'no_award',
          drawStartedAt: defaultScheduleOf(YEAR - 1).drawAt,
        },
      },
    ]);
    const harness = createService({ failingBracketId: bracketIdOf(2) });

    const result = await harness.service.advanceAll(FINAL_ADVANCE_AT);

    expect(result).toEqual({ advanced: 1, failed: [NEXT_YEAR] });
    expect(await yearOf(harness.store)).toMatchObject({
      status: 'finished',
      outcome: 'awarded',
      championEntryId: yearEntryIdOf(2),
    });
    expect(await yearOf(harness.store, yearTournamentIdOf(2))).toMatchObject({
      status: 'in_progress',
    });
    expect(harness.notifications.recordedAwards()).toEqual([
      { year: YEAR, productId: productIdOf(2), at: FINAL_ADVANCE_AT },
    ]);
    expect(harness.notifications.rounds).toEqual([
      { decidedMatchIds: [final], previewMatchIds: [], at: FINAL_ADVANCE_AT },
    ]);
    expect(
      logs.filter(({ category }) => category === PROGRESSION_CATEGORY),
    ).toEqual([
      expect.objectContaining({
        level: 'error',
        year: NEXT_YEAR,
        yearTournamentId: yearTournamentIdOf(2),
      }),
    ]);
    expect(events.map(({ tags }) => tags)).toEqual([
      {
        year: String(NEXT_YEAR),
        year_tournament_id: yearTournamentIdOf(2),
      },
    ]);
  });

  test('受賞の発行が失敗した年は失敗の一覧に入り、次の実行で発行と記録が1回ずつになる', async () => {
    const final = await seedFinal();
    await settle(final, ['lost', 'won']);
    const notifications = new RecordingYearNotificationPublisher(0, 1);
    const harness = createService({ notifications });

    expect(await harness.service.advanceAll(FINAL_ADVANCE_AT)).toEqual({
      advanced: 0,
      failed: [YEAR],
    });
    expect(await harness.service.advanceAll(RETRIED_AT)).toEqual({
      advanced: 1,
      failed: [],
    });

    expect(harness.store.recordedFinishes).toBe(1);
    expect(notifications.awards).toEqual([
      { year: YEAR, productId: productIdOf(2), at: RETRIED_AT },
    ]);
    expect(await harness.service.advanceAll(at(FINAL_DATE, 23, 55))).toEqual({
      advanced: 0,
      failed: [],
    });
  });

  test('進行中の年が無ければ何もしない', async () => {
    const { service, notifications } = createService();

    expect(await service.advanceAll(FINAL_ADVANCE_AT)).toEqual({
      advanced: 0,
      failed: [],
    });
    expect(notifications.rounds).toEqual([]);
  });
});
