import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';

import { yearTournamentEntries } from '../../../db/schema/tournament/year-tournament-entries.ts';
import { parseBusinessDate } from '../../core/time/business-time.ts';
import type {
  NewYearEntry,
  YearEntryRecord,
} from '../../core/year-tournament/ports.ts';
import {
  createRecordingDatabase,
  expectSplitWithinBindLimit,
} from '../identity/testing/identity-store-fixtures.ts';
import { matchIdOf } from '../match/testing/match-fixtures.ts';
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
import { D1YearEntryStore } from './d1-year-entry-store.ts';
import {
  championWeekTournamentIdOf,
  clearYearTournamentTables,
  insertYearEntries,
  insertYearTournaments,
  YEAR_SCHEDULE,
  type YearEntryFixture,
  yearEntryIdOf,
} from './testing/year-tournament-fixtures.ts';

const IDS_OVER_ONE_STATEMENT = 95;

const AT = new Date('2026-11-24T08:00:00.000Z');

// Week優勝の日(2026-11-23)より後の決済期限日を持つ年を凍結済みにする
const FROZEN = {
  status: 'drawing',
  drawStartedAt: YEAR_SCHEDULE.drawAt,
  updatedAt: YEAR_SCHEDULE.drawAt,
} as const;

const PURCHASE_ID = '01JD0PVRCHASE0000000000001';

const store = new D1YearEntryStore(db);

function newEntryOf(
  index: number,
  overrides: Partial<NewYearEntry> = {},
): NewYearEntry {
  return {
    entryId: yearEntryIdOf(index),
    weekTournamentId: championWeekTournamentIdOf(index),
    weekPeriod: '2026-W47',
    launchId: launchIdOf(index),
    productId: productIdOf(index),
    ownerUserId: userIdOf(1),
    launchDate: parseBusinessDate('2026-11-18'),
    qualifierMatchId: matchIdOf(index),
    qualifierUpvoteCount: 12,
    qualifierLastUpvoteElapsedMs: 5_400_000,
    awardedAt: new Date('2026-11-24T07:45:00.000Z'),
    awardedDate: parseBusinessDate('2026-11-23'),
    initialStatus: 'awaiting_payment',
    ...overrides,
  };
}

// insertYearEntriesの既定の列から求めた記録
function entryRecordOf(
  index: number,
  overrides: Partial<YearEntryRecord> = {},
): YearEntryRecord {
  return {
    entryId: yearEntryIdOf(index),
    weekTournamentId: championWeekTournamentIdOf(index),
    weekPeriod: '2026-W47',
    launchId: launchIdOf(index),
    productId: productIdOf(index),
    ownerUserId: userIdOf(1),
    launchDate: parseBusinessDate('2026-11-20'),
    qualifierUpvoteCount: 10,
    qualifierLastUpvoteElapsedMs: 3_600_000,
    awardedAt: new Date('2026-11-24T07:45:00.000Z'),
    awardedDate: parseBusinessDate('2026-11-23'),
    status: 'awaiting_payment',
    entitlementSource: null,
    purchaseId: null,
    closeReason: null,
    classifiedYear: null,
    refundStatus: 'none',
    refundNoticeStatus: 'none',
    ...overrides,
  };
}

// newEntryOfの値で挿入した受付中の枠の記録
function insertedRecordOf(
  index: number,
  overrides: Partial<YearEntryRecord> = {},
): YearEntryRecord {
  return entryRecordOf(index, {
    launchDate: parseBusinessDate('2026-11-18'),
    qualifierUpvoteCount: 12,
    qualifierLastUpvoteElapsedMs: 5_400_000,
    ...overrides,
  });
}

function entryOf(
  index: number,
  columns: YearEntryFixture['columns'] = {},
): YearEntryFixture {
  return { index, launch: index, product: index, owner: 1, columns };
}

async function readEntryRows() {
  return db
    .select()
    .from(yearTournamentEntries)
    .orderBy(yearTournamentEntries.id);
}

async function readEntryRow(index: number) {
  const [row] = await db
    .select()
    .from(yearTournamentEntries)
    .where(eq(yearTournamentEntries.id, yearEntryIdOf(index)));
  return row;
}

async function findInserted(index: number): Promise<YearEntryRecord> {
  const found = await store.findByLaunches([launchIdOf(index)]);
  const record = found.get(launchIdOf(index));
  if (record === undefined) {
    throw new Error(`枠が見つかりません: ${String(index)}`);
  }
  return record;
}

// 利用者1のプロダクト1〜4を、同じ番号のローンチ付きで作る
beforeEach(async () => {
  await clearYearTournamentTables();
  await insertUser(1);
  for (const index of [1, 2, 3, 4]) {
    await insertProduct(index, 1);
    await insertLaunch(index, index);
  }
});

describe('D1YearEntryStore.insertFromChampion', () => {
  test('受付中の枠をWeek優勝の確定値のまま挿入し、参加資格・終了・返金の列を空のままにする', async () => {
    await expect(store.insertFromChampion(newEntryOf(1), AT)).resolves.toBe(
      'inserted',
    );

    await expect(findInserted(1)).resolves.toEqual(insertedRecordOf(1));
    await expect(readEntryRow(1)).resolves.toMatchObject({
      qualifierMatchId: matchIdOf(1),
      entitledAt: null,
      closedAt: null,
      refundRequestedAt: null,
      createdAt: AT,
      updatedAt: AT,
    });
  });

  test('Ultrasの参加資格の枠は出どころをUltrasにし、資格を得た日時を挿入の日時で記録する', async () => {
    await expect(
      store.insertFromChampion(
        newEntryOf(1, { initialStatus: 'entitled' }),
        AT,
      ),
    ).resolves.toBe('inserted');

    await expect(findInserted(1)).resolves.toEqual(
      insertedRecordOf(1, { status: 'entitled', entitlementSource: 'ultras' }),
    );
    await expect(readEntryRow(1)).resolves.toMatchObject({
      entitledAt: AT,
      closedAt: null,
    });
  });

  test('同じWeek優勝の枠が既にあれば挿入せず、既存の枠を変えずに既存と返す', async () => {
    await store.insertFromChampion(newEntryOf(1), AT);
    const later = new Date('2026-11-24T08:05:00.000Z');

    await expect(
      store.insertFromChampion(
        newEntryOf(2, {
          weekTournamentId: championWeekTournamentIdOf(1),
          initialStatus: 'entitled',
        }),
        later,
      ),
    ).resolves.toBe('exists');
    await expect(store.insertFromChampion(newEntryOf(1), later)).resolves.toBe(
      'exists',
    );

    const rows = await readEntryRows();
    expect(rows.map(({ id }) => id)).toEqual([yearEntryIdOf(1)]);
    expect(rows[0]).toMatchObject({
      status: 'awaiting_payment',
      launchId: launchIdOf(1),
      updatedAt: AT,
    });
  });

  test('同じローンチの枠が既にあれば、別のWeek優勝でも挿入せず既存と返す', async () => {
    await store.insertFromChampion(newEntryOf(1), AT);

    await expect(
      store.insertFromChampion(
        newEntryOf(2, { launchId: launchIdOf(1), productId: productIdOf(1) }),
        AT,
      ),
    ).resolves.toBe('exists');

    const rows = await readEntryRows();
    expect(rows.map(({ id }) => id)).toEqual([yearEntryIdOf(1)]);
  });

  test('凍結済みの年の決済期限日がWeek優勝の日より後なら、期限切れ(遅れ)・終えた年・返金不要で挿入し遅れと返す', async () => {
    await insertYearTournaments([{ index: 1, columns: FROZEN }]);

    await expect(store.insertFromChampion(newEntryOf(1), AT)).resolves.toBe(
      'late',
    );

    await expect(findInserted(1)).resolves.toEqual(
      insertedRecordOf(1, {
        status: 'expired',
        closeReason: 'late_entry',
        classifiedYear: 2027,
        refundStatus: 'not_needed',
      }),
    );
    await expect(readEntryRow(1)).resolves.toMatchObject({
      entitledAt: null,
      closedAt: AT,
      createdAt: AT,
      updatedAt: AT,
    });
  });

  test('遅れの枠はUltrasの参加資格の枠でも参加資格を与えず、出どころを記録しない', async () => {
    await insertYearTournaments([{ index: 1, columns: FROZEN }]);

    await expect(
      store.insertFromChampion(
        newEntryOf(1, { initialStatus: 'entitled' }),
        AT,
      ),
    ).resolves.toBe('late');

    await expect(findInserted(1)).resolves.toMatchObject({
      status: 'expired',
      entitlementSource: null,
      closeReason: 'late_entry',
    });
    await expect(readEntryRow(1)).resolves.toMatchObject({ entitledAt: null });
  });

  test('決済期限日が後の凍結済みの年が複数あれば、最も早い年を終えた年に記録する', async () => {
    await insertYearTournaments([
      { index: 1, year: 2028, columns: FROZEN },
      { index: 2, year: 2027, columns: FROZEN },
    ]);

    await expect(store.insertFromChampion(newEntryOf(1), AT)).resolves.toBe(
      'late',
    );

    await expect(findInserted(1)).resolves.toMatchObject({
      classifiedYear: 2027,
    });
  });

  test('凍結していない年や、決済期限日がWeek優勝の日以前の凍結済みの年だけなら、遅れにせず挿入する', async () => {
    await insertYearTournaments([
      { index: 1, year: 2027 },
      {
        index: 2,
        year: 2026,
        columns: { ...FROZEN, deadlineDate: '2026-11-23' },
      },
      { index: 3, year: 2025, columns: FROZEN },
    ]);

    await expect(store.insertFromChampion(newEntryOf(1), AT)).resolves.toBe(
      'inserted',
    );

    await expect(findInserted(1)).resolves.toEqual(insertedRecordOf(1));
  });
});

describe('D1YearEntryStore.findByWeekTournaments', () => {
  test('枠のあるWeekトーナメントのIDだけを返し、枠の無いIDと重複を除く', async () => {
    await insertYearEntries([
      entryOf(1),
      entryOf(2, {
        status: 'drawn',
        entitlementSource: 'ultras',
        classifiedYear: 2027,
      }),
    ]);

    await expect(
      store.findByWeekTournaments([
        championWeekTournamentIdOf(1),
        championWeekTournamentIdOf(2),
        championWeekTournamentIdOf(3),
        championWeekTournamentIdOf(1),
      ]),
    ).resolves.toEqual(
      new Set([championWeekTournamentIdOf(1), championWeekTournamentIdOf(2)]),
    );
  });

  test('空の入力では問い合わせずに空の結果を返す', async () => {
    const recording = createRecordingDatabase();

    await expect(
      new D1YearEntryStore(recording.database).findByWeekTournaments([]),
    ).resolves.toEqual(new Set());
    expect(recording.placeholderCounts).toEqual([]);
  });

  test('90件を超えるIDはバインド変数の上限に収まるよう分けて引き当て、すべて結果に含める', async () => {
    const indexes = Array.from(
      { length: IDS_OVER_ONE_STATEMENT },
      (_, offset) => offset + 100,
    );
    await insertProducts(indexes, 1);
    await insertLaunches(
      indexes.map((index) => ({ index, productIndex: index })),
    );
    await insertYearEntries(indexes.map((index) => entryOf(index)));
    const recording = createRecordingDatabase();

    const found = await new D1YearEntryStore(
      recording.database,
    ).findByWeekTournaments(indexes.map(championWeekTournamentIdOf));

    expect([...found].toSorted()).toEqual(
      indexes.map(championWeekTournamentIdOf).toSorted(),
    );
    expectSplitWithinBindLimit(recording.placeholderCounts);
  });
});

describe('D1YearEntryStore.findByLaunches', () => {
  test('ローンチのIDごとに枠の記録を引き当て、枠の無いローンチは結果に含めない', async () => {
    await insertYearEntries([
      entryOf(1),
      entryOf(2, {
        status: 'entitled',
        entitlementSource: 'payment',
        purchaseId: PURCHASE_ID,
        entitledAt: AT,
        qualifierLastUpvoteElapsedMs: null,
      }),
      entryOf(3, {
        status: 'forfeited',
        closeReason: 'deleted',
        closedAt: AT,
        refundStatus: 'requested',
        refundNoticeStatus: 'pending',
      }),
    ]);

    const found = await store.findByLaunches([
      launchIdOf(1),
      launchIdOf(2),
      launchIdOf(3),
      launchIdOf(4),
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
            purchaseId: PURCHASE_ID,
            qualifierLastUpvoteElapsedMs: null,
          }),
        ],
        [
          launchIdOf(3),
          entryRecordOf(3, {
            status: 'forfeited',
            closeReason: 'deleted',
            refundStatus: 'requested',
            refundNoticeStatus: 'pending',
          }),
        ],
      ]),
    );
  });

  test('空の入力では問い合わせずに空の結果を返す', async () => {
    const recording = createRecordingDatabase();

    await expect(
      new D1YearEntryStore(recording.database).findByLaunches([]),
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
    await insertYearEntries(indexes.map((index) => entryOf(index)));
    const recording = createRecordingDatabase();

    const found = await new D1YearEntryStore(recording.database).findByLaunches(
      indexes.map(launchIdOf),
    );

    expect([...found.keys()].toSorted()).toEqual(
      indexes.map(launchIdOf).toSorted(),
    );
    expect(found.get(launchIdOf(100))).toEqual(entryRecordOf(100));
    expectSplitWithinBindLimit(recording.placeholderCounts);
  });
});

describe('D1YearEntryStore.listCandidates', () => {
  const DEADLINE_DATE = YEAR_SCHEDULE.deadlineDate;

  const UNBOUNDED = { awardedFrom: null, awardedBefore: DEADLINE_DATE };

  // 1・2は対象、3は決済期限日の当日、4は決済期限日の後、5〜8は終わった枠
  beforeEach(async () => {
    const indexes = [5, 6, 7, 8];
    await insertProducts(indexes, 1);
    await insertLaunches(
      indexes.map((index) => ({ index, productIndex: index })),
    );
    await insertYearEntries([
      entryOf(1),
      entryOf(2, {
        status: 'entitled',
        entitlementSource: 'ultras',
        entitledAt: AT,
        awardedDate: '2027-05-23',
      }),
      entryOf(3, { awardedDate: DEADLINE_DATE }),
      entryOf(4, { awardedDate: '2027-05-30' }),
      entryOf(5, {
        status: 'drawn',
        entitlementSource: 'ultras',
        classifiedYear: 2027,
      }),
      entryOf(6, {
        status: 'expired',
        closeReason: 'deadline',
        classifiedYear: 2027,
      }),
      entryOf(7, { status: 'forfeited', closeReason: 'withdrawn' }),
      entryOf(8, {
        status: 'excluded',
        closeReason: 'hidden_or_suspended',
        classifiedYear: 2027,
      }),
    ]);
  });

  test('受付中・参加資格の枠のうちWeek優勝の日が決済期限日より前のものだけを、枠のIDの昇順で返す', async () => {
    await expect(
      store.listCandidates(UNBOUNDED, undefined, 10),
    ).resolves.toEqual([
      entryRecordOf(1),
      entryRecordOf(2, {
        status: 'entitled',
        entitlementSource: 'ultras',
        awardedDate: parseBusinessDate('2027-05-23'),
      }),
    ]);
  });

  test('件数の上限と直前の枠のIDで続きから読む', async () => {
    const first = await store.listCandidates(UNBOUNDED, undefined, 1);
    const second = await store.listCandidates(UNBOUNDED, yearEntryIdOf(1), 1);
    const rest = await store.listCandidates(UNBOUNDED, yearEntryIdOf(2), 1);

    expect(first.map(({ entryId }) => entryId)).toEqual([yearEntryIdOf(1)]);
    expect(second.map(({ entryId }) => entryId)).toEqual([yearEntryIdOf(2)]);
    expect(rest).toEqual([]);
  });

  test('決済期限日を後にすると、その日より前の受付中の枠も返す', async () => {
    const candidates = await store.listCandidates(
      { awardedFrom: null, awardedBefore: parseBusinessDate('2027-05-31') },
      undefined,
      10,
    );

    expect(candidates.map(({ entryId }) => entryId)).toEqual([
      yearEntryIdOf(1),
      yearEntryIdOf(2),
      yearEntryIdOf(3),
      yearEntryIdOf(4),
    ]);
  });

  test('下限を渡すと、Week優勝の日が下限の当日以後の枠だけを返す', async () => {
    const candidates = await store.listCandidates(
      {
        awardedFrom: parseBusinessDate('2027-05-23'),
        awardedBefore: parseBusinessDate('2027-05-31'),
      },
      undefined,
      10,
    );

    expect(candidates.map(({ entryId }) => entryId)).toEqual([
      yearEntryIdOf(2),
      yearEntryIdOf(3),
      yearEntryIdOf(4),
    ]);
  });

  test('下限の前日に確定したWeek優勝の枠は返さない', async () => {
    const candidates = await store.listCandidates(
      {
        awardedFrom: parseBusinessDate('2027-05-24'),
        awardedBefore: parseBusinessDate('2027-05-31'),
      },
      undefined,
      10,
    );

    expect(candidates.map(({ entryId }) => entryId)).toEqual([
      yearEntryIdOf(3),
      yearEntryIdOf(4),
    ]);
  });
});

describe('D1YearEntryStore.findEntry', () => {
  test('枠のIDで枠の記録を読み、紐付けを解除した枠も読む', async () => {
    await insertYearEntries([
      entryOf(1, {
        status: 'entitled',
        entitlementSource: 'payment',
        purchaseId: PURCHASE_ID,
        entitledAt: AT,
      }),
      {
        index: 2,
        launch: null,
        product: null,
        owner: null,
        columns: {
          status: 'drawn',
          entitlementSource: 'ultras',
          classifiedYear: 2027,
        },
      },
    ]);

    await expect(store.findEntry(yearEntryIdOf(1))).resolves.toEqual(
      entryRecordOf(1, {
        status: 'entitled',
        entitlementSource: 'payment',
        purchaseId: PURCHASE_ID,
      }),
    );
    await expect(store.findEntry(yearEntryIdOf(2))).resolves.toEqual(
      entryRecordOf(2, {
        launchId: null,
        productId: null,
        ownerUserId: null,
        status: 'drawn',
        entitlementSource: 'ultras',
        classifiedYear: 2027,
      }),
    );
  });

  test('枠が無ければundefinedを返す', async () => {
    await expect(store.findEntry(yearEntryIdOf(9))).resolves.toBeUndefined();
  });
});

describe('D1YearEntryStore.listOpenByOwner', () => {
  // 利用者1のプロダクト1〜4と利用者2のプロダクト5
  beforeEach(async () => {
    await insertUser(2);
    await insertProduct(5, 2);
    await insertLaunch(5, 5);
  });

  test('投稿者の受付中・参加資格の枠を、凍結済みの年の枠も含めて枠のIDの昇順で返し、終わった枠と他の投稿者の枠を含めない', async () => {
    await insertYearTournaments([{ index: 1, columns: FROZEN }]);
    await insertYearEntries([
      entryOf(3, {
        status: 'entitled',
        entitlementSource: 'ultras',
        entitledAt: AT,
      }),
      entryOf(1),
      entryOf(2, {
        status: 'forfeited',
        closeReason: 'withdrawn',
        closedAt: AT,
        refundStatus: 'not_needed',
      }),
      entryOf(4, {
        status: 'drawn',
        entitlementSource: 'ultras',
        classifiedYear: 2027,
      }),
      { index: 5, launch: 5, product: 5, owner: 2 },
    ]);

    await expect(store.listOpenByOwner(userIdOf(1))).resolves.toEqual([
      entryRecordOf(1),
      entryRecordOf(3, { status: 'entitled', entitlementSource: 'ultras' }),
    ]);
  });

  test('受付中・参加資格の枠が無ければ空の一覧を返す', async () => {
    await expect(store.listOpenByOwner(userIdOf(1))).resolves.toEqual([]);
  });
});
