import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';

import { weekTournamentEntries } from '../../../db/schema/tournament/week-tournament-entries.ts';
import { weekTournaments } from '../../../db/schema/tournament/week-tournaments.ts';
import { parseBusinessDate } from '../../core/time/business-time.ts';
import type {
  NewWeekEntry,
  WeekEntryRecord,
  WeekTournamentRecord,
} from '../../core/week-tournament/ports.ts';
import { entryWindowFor } from '../../core/week-tournament/week-schedule.ts';
import {
  createRecordingDatabase,
  expectSplitWithinBindLimit,
} from '../identity/testing/identity-store-fixtures.ts';
import {
  db,
  insertLaunch,
  insertLaunches,
  insertProduct,
  insertProducts,
  insertUser,
  launchIdOf,
  productIdOf,
  userIdOf,
} from '../product/testing/product-fixtures.ts';
import {
  bracketIdOf,
  insertBrackets,
} from '../tournament/testing/bracket-fixtures.ts';
import { D1WeekTournamentStore } from './d1-week-tournament-store.ts';
import {
  clearWeekTournamentTables,
  insertWeekEntries,
  insertWeekTournaments,
  qualifierMatchIdOf,
  WEEK_START,
  WEEK_WINDOW,
  weekEntryIdOf,
  weekTournamentIdOf,
} from './testing/week-tournament-fixtures.ts';

const IDS_OVER_ONE_STATEMENT = 95;

const AT = new Date('2026-11-21T08:05:00.000Z');

const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;

const store = new D1WeekTournamentStore(db);

function openRecordOf(
  index: number,
  weekStart: string = WEEK_START,
): WeekTournamentRecord {
  return {
    tournamentId: weekTournamentIdOf(index),
    window: entryWindowFor(parseBusinessDate(weekStart)),
    status: 'open',
    drawStartedAt: null,
    bracketId: null,
    outcome: null,
    championEntryId: null,
    awardedAt: null,
  };
}

function newEntryOf(
  index: number,
  overrides: Partial<NewWeekEntry> = {},
): NewWeekEntry {
  return {
    entryId: weekEntryIdOf(index),
    tournamentId: weekTournamentIdOf(1),
    launchId: launchIdOf(index),
    productId: productIdOf(index),
    ownerUserId: userIdOf(1),
    launchDate: parseBusinessDate('2026-11-20'),
    qualifierMatchId: qualifierMatchIdOf(index),
    qualifierUpvoteCount: 12,
    qualifierLastUpvoteElapsedMs: 5_400_000,
    wonAt: new Date('2026-11-21T08:00:00.000Z'),
    status: 'awaiting_payment',
    entitlementSource: null,
    closeReason: null,
    at: AT,
    ...overrides,
  } as NewWeekEntry;
}

function entryRecordOf(
  index: number,
  overrides: Partial<WeekEntryRecord> = {},
): WeekEntryRecord {
  return {
    entryId: weekEntryIdOf(index),
    tournamentId: weekTournamentIdOf(1),
    launchId: launchIdOf(index),
    productId: productIdOf(index),
    ownerUserId: userIdOf(1),
    launchDate: parseBusinessDate('2026-11-20'),
    qualifierUpvoteCount: 10,
    qualifierLastUpvoteElapsedMs: 3_600_000,
    wonAt: new Date('2026-11-21T08:00:00.000Z'),
    status: 'awaiting_payment',
    entitlementSource: null,
    purchaseId: null,
    closeReason: null,
    refundStatus: 'none',
    refundNoticeStatus: 'none',
    ...overrides,
  };
}

async function readEntryRow(index: number) {
  const [row] = await db
    .select()
    .from(weekTournamentEntries)
    .where(eq(weekTournamentEntries.id, weekEntryIdOf(index)));
  return row;
}

// 利用者1のプロダクト1〜3を、同じ番号のローンチ付きで作る
async function seedOwner(): Promise<void> {
  await clearWeekTournamentTables();
  await insertUser(1);
  for (const index of [1, 2, 3]) {
    await insertProduct(index, 1);
    await insertLaunch(index, index);
  }
}

beforeEach(seedOwner);

describe('D1WeekTournamentStore.ensureTournament', () => {
  test('週の初日から受付期限・決済期限・組み合わせ決定の日時を求めて受付中の週を作り、記録を返す', async () => {
    const record = await store.ensureTournament(WEEK_START, AT);

    expect(record).toEqual({
      ...openRecordOf(1),
      tournamentId: expect.stringMatching(ULID) as unknown,
    });
    expect(record.window).toEqual({
      weekStart: '2026-11-16',
      acceptUntil: new Date('2026-11-24T07:00:00.000Z'),
      deadlineAt: new Date('2026-11-24T07:35:00.000Z'),
      drawAt: new Date('2026-11-24T07:45:00.000Z'),
    });
    const rows = await db.select().from(weekTournaments);
    expect(rows).toEqual([
      expect.objectContaining({
        id: record.tournamentId,
        weekStart: '2026-11-16',
        status: 'open',
        createdAt: AT,
        updatedAt: AT,
      }),
    ]);
  });

  test('同じ週を2回作っても行は1つで、同じ記録を返す', async () => {
    const first = await store.ensureTournament(WEEK_START, AT);
    const second = await store.ensureTournament(
      WEEK_START,
      new Date('2026-11-22T08:05:00.000Z'),
    );

    expect(second).toEqual(first);
    await expect(db.select().from(weekTournaments)).resolves.toHaveLength(1);
  });

  test('既にある週は重複を無視し、求め直さずに保存した列の記録を返す', async () => {
    const drawAt = new Date('2026-11-21T08:10:00.000Z');
    await insertWeekTournaments([
      {
        index: 1,
        columns: {
          drawAt,
          status: 'drawing',
          drawStartedAt: drawAt,
          updatedAt: drawAt,
        },
      },
    ]);

    const record = await store.ensureTournament(WEEK_START, AT);

    expect(record).toEqual({
      ...openRecordOf(1),
      window: { ...WEEK_WINDOW, drawAt },
      status: 'drawing',
      drawStartedAt: drawAt,
    });
    const [row] = await db.select().from(weekTournaments);
    expect(row?.updatedAt).toEqual(drawAt);
  });

  test('週の初日が月曜日でなければ例外を投げ、何も書かない', async () => {
    await expect(
      store.ensureTournament(parseBusinessDate('2026-11-17'), AT),
    ).rejects.toThrow(RangeError);
    await expect(db.select().from(weekTournaments)).resolves.toEqual([]);
  });
});

describe('D1WeekTournamentStore.findTournament・findTournamentByWeek', () => {
  test('識別子と週の初日で、組み合わせと受賞を含む週の記録を読む', async () => {
    const drawStartedAt = new Date('2026-11-24T07:45:00.000Z');
    const awardedAt = new Date('2026-11-24T07:46:00.000Z');
    await insertBrackets([{ index: 1, participantCount: 1 }]);
    await insertWeekTournaments([
      {
        index: 1,
        columns: {
          status: 'finished',
          drawStartedAt,
          drawnAt: awardedAt,
          bracketId: bracketIdOf(1),
          outcome: 'awarded',
          championEntryId: weekEntryIdOf(1),
          awardedAt,
          finishedAt: awardedAt,
        },
      },
      { index: 2, weekStart: '2026-11-23' },
    ]);
    const finished: WeekTournamentRecord = {
      ...openRecordOf(1),
      status: 'finished',
      drawStartedAt,
      bracketId: bracketIdOf(1),
      outcome: 'awarded',
      championEntryId: weekEntryIdOf(1),
      awardedAt,
    };

    await expect(store.findTournament(weekTournamentIdOf(1))).resolves.toEqual(
      finished,
    );
    await expect(store.findTournamentByWeek(WEEK_START)).resolves.toEqual(
      finished,
    );
    await expect(
      store.findTournamentByWeek(parseBusinessDate('2026-11-23')),
    ).resolves.toEqual(openRecordOf(2, '2026-11-23'));
  });

  test('無い週はundefinedを返す', async () => {
    await expect(
      store.findTournament(weekTournamentIdOf(9)),
    ).resolves.toBeUndefined();
    await expect(
      store.findTournamentByWeek(WEEK_START),
    ).resolves.toBeUndefined();
  });
});

describe('D1WeekTournamentStore.listDue', () => {
  // 週1・2・3・4の組み合わせ決定は11/10・11/17・11/24・12/01の7:45(UTC)
  async function seedWeeks(): Promise<void> {
    await insertWeekTournaments([
      { index: 3, weekStart: '2026-11-16' },
      { index: 1, weekStart: '2026-11-02', columns: { status: 'drawing' } },
      { index: 2, weekStart: '2026-11-09' },
      { index: 4, weekStart: '2026-11-23' },
      { index: 5, weekStart: '2026-10-26', columns: { status: 'in_progress' } },
      { index: 6, weekStart: '2026-10-19', columns: { status: 'finished' } },
    ]);
  }

  test('組み合わせ決定の日時が到来した受付中と組み合わせ決定中の週だけを、日時の昇順で返す', async () => {
    await seedWeeks();

    const due = await store.listDue(WEEK_WINDOW.drawAt, 10);

    expect(due.map(({ tournamentId }) => tournamentId)).toEqual([
      weekTournamentIdOf(1),
      weekTournamentIdOf(2),
      weekTournamentIdOf(3),
    ]);
    expect(due[0]).toEqual({
      ...openRecordOf(1, '2026-11-02'),
      status: 'drawing',
    });
  });

  test('組み合わせ決定の日時の1ミリ秒前の週は返さない', async () => {
    await seedWeeks();

    const due = await store.listDue(
      new Date(WEEK_WINDOW.drawAt.getTime() - 1),
      10,
    );

    expect(due.map(({ tournamentId }) => tournamentId)).toEqual([
      weekTournamentIdOf(1),
      weekTournamentIdOf(2),
    ]);
  });

  test('件数の上限まで古い週から返す', async () => {
    await seedWeeks();

    const due = await store.listDue(WEEK_WINDOW.drawAt, 2);

    expect(due.map(({ tournamentId }) => tournamentId)).toEqual([
      weekTournamentIdOf(1),
      weekTournamentIdOf(2),
    ]);
  });
});

describe('D1WeekTournamentStore.listInProgress', () => {
  test('進行中の週だけを週の初日の昇順に、件数の上限まで返す', async () => {
    await insertWeekTournaments([
      { index: 3, weekStart: '2026-11-16', columns: { status: 'in_progress' } },
      { index: 1, weekStart: '2026-11-02', columns: { status: 'in_progress' } },
      { index: 2, weekStart: '2026-11-09', columns: { status: 'in_progress' } },
      { index: 4, weekStart: '2026-10-26', columns: { status: 'finished' } },
      { index: 5, weekStart: '2026-10-19', columns: { status: 'drawing' } },
      { index: 6, weekStart: '2026-11-23' },
    ]);

    const all = await store.listInProgress(10);
    const limited = await store.listInProgress(2);

    expect(all.map(({ tournamentId }) => tournamentId)).toEqual([
      weekTournamentIdOf(1),
      weekTournamentIdOf(2),
      weekTournamentIdOf(3),
    ]);
    expect(all[0]).toEqual({
      ...openRecordOf(1, '2026-11-02'),
      status: 'in_progress',
    });
    expect(limited.map(({ tournamentId }) => tournamentId)).toEqual([
      weekTournamentIdOf(1),
      weekTournamentIdOf(2),
    ]);
  });
});

describe('D1WeekTournamentStore.findEntriesByLaunch・findEntry', () => {
  test('ローンチのIDごとに参加の枠の記録を引き当て、枠の無いローンチは結果に含めない', async () => {
    const entitledAt = new Date('2026-11-22T08:00:00.000Z');
    await insertWeekTournaments([{ index: 1 }]);
    await insertWeekEntries([
      { index: 1, tournament: 1, launch: 1, product: 1, owner: 1 },
      {
        index: 2,
        tournament: 1,
        launch: 2,
        product: 2,
        owner: 1,
        columns: {
          status: 'entitled',
          entitlementSource: 'payment',
          purchaseId: '01JD0PVRCHASE0000000000001',
          entitledAt,
          qualifierLastUpvoteElapsedMs: null,
        },
      },
    ]);

    const found = await store.findEntriesByLaunch([
      launchIdOf(1),
      launchIdOf(2),
      launchIdOf(3),
      launchIdOf(1),
    ]);

    expect(found).toEqual(
      new Map([
        [launchIdOf(1), entryRecordOf(1)],
        [
          launchIdOf(2),
          entryRecordOf(2, {
            status: 'entitled',
            entitlementSource: 'payment',
            purchaseId: '01JD0PVRCHASE0000000000001',
            qualifierLastUpvoteElapsedMs: null,
          }),
        ],
      ]),
    );
  });

  test('空の入力では問い合わせずに空の結果を返す', async () => {
    const recording = createRecordingDatabase();

    await expect(
      new D1WeekTournamentStore(recording.database).findEntriesByLaunch([]),
    ).resolves.toEqual(new Map());
    expect(recording.placeholderCounts).toEqual([]);
  });

  test('90件を超えるローンチはバインド変数の上限に収まるよう分けて引き当て、すべて結果に含める', async () => {
    const indexes = Array.from(
      { length: IDS_OVER_ONE_STATEMENT },
      (_, offset) => offset + 100,
    );
    await insertProducts(indexes, 1);
    await insertLaunches(
      indexes.map((index) => ({ index, productIndex: index })),
    );
    await insertWeekTournaments([{ index: 1 }]);
    await insertWeekEntries(
      indexes.map((index) => ({
        index,
        tournament: 1,
        launch: index,
        product: index,
        owner: 1,
      })),
    );
    const recording = createRecordingDatabase();

    const found = await new D1WeekTournamentStore(
      recording.database,
    ).findEntriesByLaunch(indexes.map(launchIdOf));

    expect([...found.keys()].toSorted()).toEqual(
      indexes.map(launchIdOf).toSorted(),
    );
    expect(found.get(launchIdOf(100))).toEqual(entryRecordOf(100));
    expectSplitWithinBindLimit(recording.placeholderCounts);
  });

  test('紐付けを解除した枠の記録を枠のIDで読み、無い枠はundefinedを返す', async () => {
    const closedAt = new Date('2026-11-24T07:45:00.000Z');
    await insertWeekTournaments([{ index: 1 }]);
    await insertWeekEntries([
      {
        index: 1,
        tournament: 1,
        launch: null,
        product: null,
        owner: null,
        columns: {
          status: 'drawn',
          entitlementSource: 'ultras',
          closedAt,
          refundStatus: 'not_needed',
        },
      },
    ]);

    await expect(store.findEntry(weekEntryIdOf(1))).resolves.toEqual(
      entryRecordOf(1, {
        launchId: null,
        productId: null,
        ownerUserId: null,
        status: 'drawn',
        entitlementSource: 'ultras',
        refundStatus: 'not_needed',
      }),
    );
    await expect(store.findEntry(weekEntryIdOf(9))).resolves.toBeUndefined();
  });
});

describe('D1WeekTournamentStore.insertEntry', () => {
  beforeEach(async () => {
    await insertWeekTournaments([
      { index: 1 },
      { index: 2, weekStart: '2026-11-23' },
    ]);
  });

  test('受付中の枠を予選の確定値のまま挿入し、参加資格・終了・返金の列を空のままにする', async () => {
    await expect(store.insertEntry(newEntryOf(1))).resolves.toBe('inserted');

    await expect(store.findEntry(weekEntryIdOf(1))).resolves.toEqual(
      entryRecordOf(1, {
        qualifierUpvoteCount: 12,
        qualifierLastUpvoteElapsedMs: 5_400_000,
      }),
    );
    await expect(readEntryRow(1)).resolves.toMatchObject({
      qualifierMatchId: qualifierMatchIdOf(1),
      entitledAt: null,
      closedAt: null,
      refundRequestedAt: null,
      createdAt: AT,
      updatedAt: AT,
    });
  });

  test('Ultrasの参加資格の枠は資格を得た日時を挿入の日時で記録する', async () => {
    await expect(
      store.insertEntry(
        newEntryOf(1, {
          status: 'entitled',
          entitlementSource: 'ultras',
          qualifierLastUpvoteElapsedMs: null,
        }),
      ),
    ).resolves.toBe('inserted');

    await expect(store.findEntry(weekEntryIdOf(1))).resolves.toMatchObject({
      status: 'entitled',
      entitlementSource: 'ultras',
      qualifierLastUpvoteElapsedMs: null,
    });
    await expect(readEntryRow(1)).resolves.toMatchObject({
      entitledAt: AT,
      closedAt: null,
    });
  });

  test('遅れた勝利の期限切れの枠は終了の日時と理由を挿入の日時で記録する', async () => {
    await expect(
      store.insertEntry(
        newEntryOf(1, { status: 'expired', closeReason: 'late_entry' }),
      ),
    ).resolves.toBe('inserted');

    await expect(store.findEntry(weekEntryIdOf(1))).resolves.toMatchObject({
      status: 'expired',
      entitlementSource: null,
      closeReason: 'late_entry',
    });
    await expect(readEntryRow(1)).resolves.toMatchObject({
      entitledAt: null,
      closedAt: AT,
    });
  });

  test('同じローンチの枠は2回目を挿入せずexistsを返し、最初の枠を変えない', async () => {
    await store.insertEntry(newEntryOf(1));

    await expect(
      store.insertEntry(
        newEntryOf(1, {
          entryId: weekEntryIdOf(2),
          tournamentId: weekTournamentIdOf(2),
          qualifierUpvoteCount: 99,
        }),
      ),
    ).resolves.toBe('exists');

    const rows = await db.select().from(weekTournamentEntries);
    expect(rows).toEqual([
      expect.objectContaining({
        id: weekEntryIdOf(1),
        tournamentId: weekTournamentIdOf(1),
        qualifierUpvoteCount: 12,
      }),
    ]);
  });

  test('同じ週の同じプロダクトの別のローンチは挿入せずexistsを返す', async () => {
    await insertLaunch(4, 1, {
      launchDate: '2026-11-18',
      outcome: 'won',
      decidedAt: new Date('2026-11-19T08:00:00.000Z'),
    });
    await store.insertEntry(
      newEntryOf(4, {
        productId: productIdOf(1),
        launchDate: parseBusinessDate('2026-11-18'),
      }),
    );

    await expect(store.insertEntry(newEntryOf(1))).resolves.toBe('exists');

    await expect(store.findEntry(weekEntryIdOf(1))).resolves.toBeUndefined();
  });

  test('同じプロダクトでも別の週の枠は挿入する', async () => {
    await insertLaunch(4, 1, {
      launchDate: '2026-11-25',
      outcome: 'won',
      decidedAt: new Date('2026-11-26T08:00:00.000Z'),
    });
    await store.insertEntry(newEntryOf(1));

    await expect(
      store.insertEntry(
        newEntryOf(4, {
          tournamentId: weekTournamentIdOf(2),
          productId: productIdOf(1),
          launchDate: parseBusinessDate('2026-11-25'),
        }),
      ),
    ).resolves.toBe('inserted');

    await expect(db.select().from(weekTournamentEntries)).resolves.toHaveLength(
      2,
    );
  });
});
