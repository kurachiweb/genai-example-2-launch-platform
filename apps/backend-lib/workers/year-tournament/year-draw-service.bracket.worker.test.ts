import type { Event } from '@sentry/cloudflare';
import { asc, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { matches } from '../../../db/schema/match/matches.ts';
import { bracketParticipants } from '../../../db/schema/tournament/bracket-participants.ts';
import { tournamentBrackets } from '../../../db/schema/tournament/tournament-brackets.ts';
import { TOURNAMENT_YEAR_ENTRY_REFUND_KIND } from '../../core/email/kinds/tournament-year.ts';
import type { LogObject } from '../../core/logging/log-record.ts';
import {
  type BusinessDate,
  fromBusinessDateTime,
  parseBusinessDate,
} from '../../core/time/business-time.ts';
import { emailOf } from '../identity/testing/identity-store-fixtures.ts';
import { sequentialIdOf } from '../match/testing/event-fixtures.ts';
import {
  db,
  insertUser,
  launchIdOf,
  productIdOf,
  T0,
} from '../product/testing/product-fixtures.ts';
import {
  installRecordingSentry,
  recordLogs,
  resetObservability,
} from '../tournament/testing/observability-fixtures.ts';
import { readEntriesOf } from '../tournament/testing/progression-fixtures.ts';
import {
  ENTITLED_BY_PAYMENT,
  PLAIN_OWNER,
  seedProducts,
} from '../week-tournament/testing/draw-service-fixtures.ts';
import {
  createDrawService,
  DRAW_AT,
  DRAW_CATEGORY,
  DRAW_MATCH_IDS,
  entryOf,
  readDrawnYear,
  readEntry,
  YEAR_TOURNAMENT_ID,
} from './testing/year-draw-fixtures.ts';
import { purchaseIdOf } from './testing/year-entry-follow-up-fixtures.ts';
import {
  clearYearTournamentTables,
  insertYearEntries,
  insertYearTournaments,
  YEAR,
  YEAR_SCHEDULE,
  type YearEntryFixture,
  yearEntryIdOf,
  yearTournamentIdOf,
} from './testing/year-tournament-fixtures.ts';

// 2027年の決勝日(5/30)。組み合わせ決定は決済期限日(5/24)の23:45
const FINAL_DATE = YEAR_SCHEDULE.finalDate;

const NEXT_YEAR = YEAR + 1;

let logs: LogObject[] = [];
let events: Event[] = [];

function paidEntryOf(
  index: number,
  upvoteCount: number,
  columns: YearEntryFixture['columns'] = {},
): YearEntryFixture {
  return entryOf(index, PLAIN_OWNER, {
    ...ENTITLED_BY_PAYMENT,
    purchaseId: purchaseIdOf(index),
    qualifierUpvoteCount: upvoteCount,
    ...columns,
  });
}

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, offset) => from + offset);
}

async function seedPaidEntries(
  entries: readonly YearEntryFixture[],
): Promise<void> {
  await seedProducts(
    PLAIN_OWNER,
    entries.map(({ index }) => index),
  );
  await insertYearEntries(entries);
}

async function readParticipantRefs(bracketId: string): Promise<string[]> {
  const rows = await db
    .select({ entryRef: bracketParticipants.entryRef })
    .from(bracketParticipants)
    .where(eq(bracketParticipants.bracketId, bracketId))
    .orderBy(asc(bracketParticipants.participantNo));
  return rows.map(({ entryRef }) => entryRef);
}

async function readAllMatches() {
  return db
    .select({
      id: matches.id,
      kind: matches.kind,
      round: matches.round,
      matchDate: matches.matchDate,
      startsAt: matches.startsAt,
      endsAt: matches.endsAt,
    })
    .from(matches)
    .orderBy(asc(matches.id));
}

async function readBracketRows() {
  return db
    .select({
      id: tournamentBrackets.id,
      kind: tournamentBrackets.kind,
      tournamentId: tournamentBrackets.tournamentId,
      status: tournamentBrackets.status,
      outcome: tournamentBrackets.outcome,
    })
    .from(tournamentBrackets)
    .orderBy(asc(tournamentBrackets.tournamentId));
}

function matchOn(date: BusinessDate, index: number) {
  return {
    id: sequentialIdOf(index),
    kind: 'year',
    round: 1,
    matchDate: date,
    startsAt: fromBusinessDateTime(date, { hour: 0, minute: 0 }),
    endsAt: fromBusinessDateTime(date, { hour: 23, minute: 40 }),
  };
}

beforeEach(async () => {
  logs = recordLogs();
  events = installRecordingSentry();
  await clearYearTournamentTables();
  await insertUser(PLAIN_OWNER);
  await insertYearTournaments([{ index: 1 }]);
});

afterEach(resetObservability);

describe('YearTournamentDrawService.drawDue(組み合わせと1回戦の予定)', () => {
  test('参加13なら共用の並びで組み合わせ、決勝日の3日前の0:00開始・23:40終了の1回戦をマッチのテーブルに作り、その前の日にはマッチを作らない', async () => {
    // 1〜5はローンチ日が早く、6〜10は遅い非シード。11〜13はUpvote数の多いシード
    await seedPaidEntries([
      ...range(1, 5).map((index) =>
        paidEntryOf(index, index, { launchDate: '2026-11-13' }),
      ),
      ...range(6, 13).map((index) => paidEntryOf(index, index)),
    ]);
    const { service, notifications } = createDrawService();

    await expect(service.drawDue(DRAW_AT)).resolves.toEqual({
      drawn: [YEAR],
      failed: [],
    });

    const firstRoundDate = parseBusinessDate('2027-05-27');
    const [bracket] = await readBracketRows();
    expect(bracket).toMatchObject({
      kind: 'year',
      tournamentId: YEAR_TOURNAMENT_ID,
      status: 'active',
    });
    const bracketId = bracket?.id ?? '';
    await expect(readParticipantRefs(bracketId)).resolves.toEqual(
      [13, 12, 11, 5, 4, 3, 2, 1, 10, 9, 8, 7, 6].map(yearEntryIdOf),
    );
    const expectedMatches = range(0, 4).map((offset) =>
      matchOn(firstRoundDate, DRAW_MATCH_IDS + offset),
    );
    await expect(readAllMatches()).resolves.toEqual(expectedMatches);
    const enteredLaunches = (
      await Promise.all(expectedMatches.map(({ id }) => readEntriesOf(id)))
    )
      .flat()
      .map(({ launchId }) => launchId)
      .toSorted();
    expect(enteredLaunches).toEqual(range(1, 10).map(launchIdOf).toSorted());
    await expect(readDrawnYear()).resolves.toEqual({
      status: 'in_progress',
      bracketId,
      firstRoundDate,
      participantCount: 13,
      drawnAt: DRAW_AT,
      outcome: null,
      championEntryId: null,
      awardedAt: null,
    });
    expect(notifications.events()).toEqual(
      expectedMatches.map(({ id }) => ({ type: 'match_preview', matchId: id })),
    );
  });

  test('参加2なら決勝日に0:00開始・23:40終了の決勝の1試合だけを作る', async () => {
    await seedPaidEntries([paidEntryOf(1, 10), paidEntryOf(2, 20)]);
    const { service, notifications } = createDrawService();

    await service.drawDue(DRAW_AT);

    const finalMatch = matchOn(FINAL_DATE, DRAW_MATCH_IDS);
    await expect(readAllMatches()).resolves.toEqual([finalMatch]);
    await expect(readEntriesOf(finalMatch.id)).resolves.toEqual([
      expect.objectContaining({ slot: 1, launchId: launchIdOf(2) }),
      expect.objectContaining({ slot: 2, launchId: launchIdOf(1) }),
    ]);
    await expect(readDrawnYear()).resolves.toMatchObject({
      status: 'in_progress',
      firstRoundDate: FINAL_DATE,
      participantCount: 2,
    });
    expect(notifications.events()).toEqual([
      { type: 'match_preview', matchId: finalMatch.id },
    ]);
  });

  test('参加1ならマッチを作らずに受賞で終えた結果を記録し、その後に受賞を発行する', async () => {
    await seedPaidEntries([paidEntryOf(1, 10)]);
    await seedProducts(PLAIN_OWNER, [2]);
    await insertYearEntries([entryOf(2, PLAIN_OWNER)]);
    const { service, notifications, calls } = createDrawService();

    await expect(service.drawDue(DRAW_AT)).resolves.toEqual({
      drawn: [YEAR],
      failed: [],
    });

    const [bracket] = await readBracketRows();
    expect(bracket).toMatchObject({ status: 'finished', outcome: 'champion' });
    await expect(readDrawnYear()).resolves.toEqual({
      status: 'finished',
      bracketId: bracket?.id,
      firstRoundDate: null,
      participantCount: 1,
      drawnAt: DRAW_AT,
      outcome: 'awarded',
      championEntryId: yearEntryIdOf(1),
      awardedAt: DRAW_AT,
    });
    await expect(readAllMatches()).resolves.toEqual([]);
    expect(calls.slice(-4)).toEqual([
      'bracketDraw',
      'markDrawn',
      'applyResult',
      'processYear',
    ]);
    expect(notifications.statusesAtAward).toEqual(['finished']);
    expect(notifications.events()).toEqual([
      {
        type: 'award',
        award: 'product_of_the_year',
        period: String(YEAR),
        productId: productIdOf(1),
      },
    ]);
  });

  test('参加0ならマッチを作らずに受賞なしで終え、何も発行しない', async () => {
    await seedProducts(PLAIN_OWNER, [1]);
    await insertYearEntries([entryOf(1, PLAIN_OWNER)]);
    const { service, notifications } = createDrawService();

    await expect(service.drawDue(DRAW_AT)).resolves.toEqual({
      drawn: [YEAR],
      failed: [],
    });

    await expect(readDrawnYear()).resolves.toEqual({
      status: 'finished',
      bracketId: expect.any(String) as unknown,
      firstRoundDate: null,
      participantCount: 0,
      drawnAt: DRAW_AT,
      outcome: 'no_award',
      championEntryId: null,
      awardedAt: null,
    });
    await expect(readAllMatches()).resolves.toEqual([]);
    expect(notifications.events()).toEqual([]);
  });
});

describe('YearTournamentDrawService.drawDue(後処理)', () => {
  test('除外した決済の枠の返金を依頼して知らせを送り、期限切れの枠には依頼しない', async () => {
    await seedPaidEntries([paidEntryOf(1, 10), paidEntryOf(2, 20)]);
    await seedProducts(PLAIN_OWNER, [3], { hiddenAt: T0 });
    await seedProducts(PLAIN_OWNER, [4]);
    await insertYearEntries([paidEntryOf(3, 30), entryOf(4, PLAIN_OWNER)]);
    const { service, refundRequests, sent } = createDrawService();

    await service.drawDue(DRAW_AT);

    expect(refundRequests).toEqual([
      expect.objectContaining({ purchaseId: purchaseIdOf(3), amount: null }),
    ]);
    expect(sent).toEqual([
      expect.objectContaining({
        kind: TOURNAMENT_YEAR_ENTRY_REFUND_KIND,
        to: emailOf(PLAIN_OWNER),
      }),
    ]);
    await expect(readEntry(3)).resolves.toMatchObject({
      status: 'excluded',
      closeReason: 'hidden_or_suspended',
      refundStatus: 'requested',
    });
    await expect(readEntry(4)).resolves.toMatchObject({
      status: 'expired',
      refundStatus: 'none',
    });
  });
});

describe('YearTournamentDrawService.drawDue(年ごとの失敗)', () => {
  // 2028年の対象期間(2027-05-24〜2028-05-21)のWeek優勝
  const NEXT_YEAR_AWARD = {
    awardedAt: new Date('2027-11-23T07:45:00.000Z'),
    awardedDate: '2027-11-22',
  };

  const NEXT_DRAW_AT = fromBusinessDateTime(parseBusinessDate('2028-05-22'), {
    hour: 23,
    minute: 45,
  });

  const LATER = new Date(NEXT_DRAW_AT.getTime() + 600_000);

  beforeEach(async () => {
    await insertYearTournaments([{ index: 2, year: NEXT_YEAR }]);
    await seedPaidEntries([
      paidEntryOf(1, 10),
      paidEntryOf(2, 20),
      paidEntryOf(3, 30, NEXT_YEAR_AWARD),
      paidEntryOf(4, 40, NEXT_YEAR_AWARD),
    ]);
  });

  test('組み合わせに失敗した年は組み合わせ決定中のまま失敗として返して通知し、後の年の組み合わせを止めない', async () => {
    const { service } = createDrawService({
      failDrawOf: yearTournamentIdOf(1),
    });

    await expect(service.drawDue(NEXT_DRAW_AT)).resolves.toEqual({
      drawn: [NEXT_YEAR],
      failed: [YEAR],
    });

    await expect(readDrawnYear(1)).resolves.toMatchObject({
      status: 'drawing',
      bracketId: null,
    });
    await expect(readDrawnYear(2)).resolves.toMatchObject({
      status: 'in_progress',
      participantCount: 2,
    });
    expect(events.map(({ tags }) => tags)).toEqual([
      {
        tournament_year_incident: 'draw-failed',
        year: String(YEAR),
        year_tournament_id: yearTournamentIdOf(1),
      },
    ]);
  });

  test('2年が同時に到来し前の年が分類の途中で失敗しても、後の年は前の年の枠を分類せず、前の年の再実行でその枠が前の年に分類される', async () => {
    const failing = createDrawService({ failClassifyOf: YEAR });

    await expect(failing.service.drawDue(NEXT_DRAW_AT)).resolves.toEqual({
      drawn: [NEXT_YEAR],
      failed: [YEAR],
    });

    expect(failing.entries.candidateRanges).toEqual([
      { awardedFrom: null, awardedBefore: YEAR_SCHEDULE.deadlineDate },
      {
        awardedFrom: YEAR_SCHEDULE.deadlineDate,
        awardedBefore: parseBusinessDate('2028-05-22'),
      },
    ]);
    for (const index of [1, 2]) {
      await expect(readEntry(index)).resolves.toMatchObject({
        status: 'entitled',
        classifiedYear: null,
      });
    }
    for (const index of [3, 4]) {
      await expect(readEntry(index)).resolves.toMatchObject({
        status: 'drawn',
        classifiedYear: NEXT_YEAR,
      });
    }

    const { service } = createDrawService();
    await expect(service.drawDue(LATER)).resolves.toEqual({
      drawn: [YEAR],
      failed: [],
    });

    for (const index of [1, 2]) {
      await expect(readEntry(index)).resolves.toMatchObject({
        status: 'drawn',
        classifiedYear: YEAR,
      });
    }
    await expect(readDrawnYear(1)).resolves.toMatchObject({
      status: 'in_progress',
      participantCount: 2,
    });
  });
});

describe('YearTournamentDrawService.drawDue(ログとエラートラッキング)', () => {
  test('組み合わせの記録は年・ブラケットの識別と件数だけをログに残す', async () => {
    await seedPaidEntries([paidEntryOf(1, 10), paidEntryOf(2, 20)]);
    const { service } = createDrawService();

    await service.drawDue(DRAW_AT);

    const [bracket] = await readBracketRows();
    expect(logs.filter(({ category }) => category === DRAW_CATEGORY)).toEqual([
      {
        time: expect.any(String) as unknown,
        category: DRAW_CATEGORY,
        message: expect.any(String) as unknown,
        level: 'info',
        yearTournamentId: YEAR_TOURNAMENT_ID,
        year: YEAR,
        participantCount: 2,
        overCapacityCount: 0,
      },
      {
        time: expect.any(String) as unknown,
        category: DRAW_CATEGORY,
        message: expect.any(String) as unknown,
        level: 'info',
        yearTournamentId: YEAR_TOURNAMENT_ID,
        year: YEAR,
        bracketId: bracket?.id,
        participantCount: 2,
      },
    ]);
  });

  test('後処理の失敗のログとエラートラッキングに、プロダクトの名称・メールアドレス・ハンドルを含めない', async () => {
    await seedPaidEntries([paidEntryOf(1, 10), paidEntryOf(2, 20)]);
    await seedProducts(PLAIN_OWNER, [3], { hiddenAt: T0 });
    await insertYearEntries([paidEntryOf(3, 30)]);
    const { service } = createDrawService({
      emailFailure: new Error('メールの送信の一時的な失敗'),
    });

    await expect(service.drawDue(DRAW_AT)).resolves.toEqual({
      drawn: [],
      failed: [YEAR],
    });

    expect(
      logs.filter(
        ({ category, level }) =>
          category === DRAW_CATEGORY && level === 'error',
      ),
    ).toEqual([
      expect.objectContaining({
        yearTournamentId: YEAR_TOURNAMENT_ID,
        year: YEAR,
      }),
    ]);
    expect(events).toHaveLength(1);
    const output = JSON.stringify([logs, events]);
    for (const index of [1, 2, 3]) {
      expect(output).not.toContain(`プロダクト${String(index)}`);
      expect(output).not.toContain(`product${String(index)}`);
    }
    expect(output).not.toContain(emailOf(PLAIN_OWNER));
    expect(output).not.toContain(`user${String(PLAIN_OWNER)}`);
  });
});
