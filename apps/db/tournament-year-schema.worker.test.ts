import { env } from 'cloudflare:workers';
import { eq, ne } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';

import { createDatabase } from './client.ts';
import { users } from './schema/identity/users.ts';
import { productCategories } from './schema/product/product-categories.ts';
import { productLaunches } from './schema/product/product-launches.ts';
import { products } from './schema/product/products.ts';
import { tournamentBrackets } from './schema/tournament/tournament-brackets.ts';
import { yearTournamentEntries } from './schema/tournament/year-tournament-entries.ts';
import { yearTournaments } from './schema/tournament/year-tournaments.ts';

const OTHER_CATEGORY_ID = '01JD0000000000000000000000';

const OWNER_ID = '01JD0000000000000000000U01';

const PRODUCT_ID = '01JD0000000000000000000P01';

const LAUNCH_ID = '01JD0000000000000000000L01';

const SECOND_LAUNCH_ID = '01JD0000000000000000000L02';

const YEAR_TOURNAMENT_ID = '01JD0000000000000000000Y01';

const WEEK_TOURNAMENT_ID = '01JD0000000000000000000W01';

const BRACKET_ID = '01JD0000000000000000000B01';

const LAUNCH_DATE = '2026-11-16';

const AT = new Date(Date.UTC(2026, 10, 16));

const db = createDatabase(env.DB);

// Drizzleは単独のクエリの失敗をDrizzleQueryErrorで包んでD1のエラーをcauseに持つため、原因をたどって文言を集める
async function rejectionMessagesOf(
  pending: Promise<unknown>,
): Promise<string[]> {
  const reason: unknown = await pending.then(
    () => undefined,
    (error: unknown) => error,
  );
  const messages: string[] = [];
  for (
    let current = reason;
    current instanceof Error;
    current = current.cause
  ) {
    messages.push(current.message);
  }
  return messages;
}

function yearOf(
  overrides: Partial<typeof yearTournaments.$inferInsert> = {},
): typeof yearTournaments.$inferInsert {
  return {
    id: YEAR_TOURNAMENT_ID,
    year: 2027,
    finalDate: '2027-05-30',
    finalDateSource: 'default',
    deadlineDate: '2027-05-24',
    acceptUntil: AT,
    deadlineAt: AT,
    drawAt: AT,
    changeLockAt: AT,
    status: 'open',
    ...overrides,
  };
}

function entryOf(
  id: string,
  overrides: Partial<typeof yearTournamentEntries.$inferInsert> = {},
): typeof yearTournamentEntries.$inferInsert {
  return {
    id,
    weekTournamentId: WEEK_TOURNAMENT_ID,
    weekPeriod: '2026-W47',
    launchId: LAUNCH_ID,
    productId: PRODUCT_ID,
    ownerUserId: OWNER_ID,
    launchDate: LAUNCH_DATE,
    qualifierMatchId: '01JD0000000000000000000M01',
    qualifierUpvoteCount: 3,
    qualifierLastUpvoteElapsedMs: 1000,
    awardedAt: AT,
    awardedDate: '2026-11-22',
    status: 'awaiting_payment',
    ...overrides,
  };
}

beforeEach(async () => {
  await db.delete(yearTournamentEntries);
  await db.delete(yearTournaments);
  await db.delete(tournamentBrackets);
  await db.delete(productLaunches);
  await db.delete(products);
  await db
    .delete(productCategories)
    .where(ne(productCategories.id, OTHER_CATEGORY_ID));
  await db.delete(users);
  await db.insert(users).values({
    id: OWNER_ID,
    pseudonymousId: 'pseudonymous-0',
    email: 'user0@launch.example',
    passwordHash: 'hash',
    nickname: '利用者0',
    handle: 'user0',
    termsAgreedAt: AT,
  });
  await db.insert(products).values({
    id: PRODUCT_ID,
    userId: OWNER_ID,
    categoryId: OTHER_CATEGORY_ID,
    handle: 'first',
    name: '名称',
    tagline: 'タグライン',
    websiteUrl: 'https://product.example/',
    descriptionMarkdown: '説明文',
    logoFileId: 'logo-first',
    latestLaunchDate: LAUNCH_DATE,
  });
  await db.insert(productLaunches).values([
    {
      id: LAUNCH_ID,
      productId: PRODUCT_ID,
      launchDate: LAUNCH_DATE,
      outcome: 'won',
      decidedAt: AT,
    },
    {
      id: SECOND_LAUNCH_ID,
      productId: PRODUCT_ID,
      launchDate: '2026-11-17',
      outcome: 'won',
      decidedAt: AT,
    },
  ]);
});

describe('年のトーナメントの制約', () => {
  test.each([999, 10000])('対象年%iは範囲の外で作れない', async (year) => {
    expect(
      await rejectionMessagesOf(
        db.insert(yearTournaments).values(yearOf({ year })),
      ),
    ).toContainEqual(
      expect.stringContaining(
        'CHECK constraint failed: year_tournaments_year_range_check',
      ),
    );
  });

  test('同じ対象年の行を2つ作れない', async () => {
    await db.insert(yearTournaments).values(yearOf());

    expect(
      await rejectionMessagesOf(
        db
          .insert(yearTournaments)
          .values(yearOf({ id: '01JD0000000000000000000Y02' })),
      ),
    ).toContainEqual(
      expect.stringContaining(
        'UNIQUE constraint failed: year_tournaments.year',
      ),
    );
  });

  test('既定の決勝日は版0で作れ、設定済みの決勝日は版0では作れない', async () => {
    await db.insert(yearTournaments).values(yearOf());

    const [row] = await db
      .select({ version: yearTournaments.finalDateVersion })
      .from(yearTournaments);

    expect(row).toEqual({ version: 0 });
    expect(
      await rejectionMessagesOf(
        db
          .update(yearTournaments)
          .set({ finalDateSource: 'explicit' })
          .where(eq(yearTournaments.id, YEAR_TOURNAMENT_ID)),
      ),
    ).toContainEqual(
      expect.stringContaining(
        'CHECK constraint failed: year_tournaments_explicit_version_check',
      ),
    );
  });

  test('設定済みの決勝日は版1以上で保存できる', async () => {
    await db.insert(yearTournaments).values(yearOf());

    await db
      .update(yearTournaments)
      .set({ finalDateSource: 'explicit', finalDateVersion: 1 })
      .where(eq(yearTournaments.id, YEAR_TOURNAMENT_ID));

    expect(await db.$count(yearTournaments)).toBe(1);
  });

  test('決勝日の出どころは設定済みと既定に限る', async () => {
    expect(
      await rejectionMessagesOf(
        db
          .insert(yearTournaments)
          .values(yearOf({ finalDateSource: 'manual' as 'explicit' })),
      ),
    ).toContainEqual(
      expect.stringContaining(
        'CHECK constraint failed: year_tournaments_final_date_source_check',
      ),
    );
  });

  test('終了した年は結果が無いと作れない', async () => {
    expect(
      await rejectionMessagesOf(
        db.insert(yearTournaments).values(yearOf({ status: 'finished' })),
      ),
    ).toContainEqual(
      expect.stringContaining(
        'CHECK constraint failed: year_tournaments_finished_outcome_check',
      ),
    );
  });

  test('受賞の結果は優勝の枠が無いと作れない', async () => {
    expect(
      await rejectionMessagesOf(
        db
          .insert(yearTournaments)
          .values(yearOf({ status: 'finished', outcome: 'awarded' })),
      ),
    ).toContainEqual(
      expect.stringContaining(
        'CHECK constraint failed: year_tournaments_awarded_champion_check',
      ),
    );
  });

  test('授与なしで終了した年は優勝の枠が無くても作れ、優勝の枠は枠の行が無くても記録できる', async () => {
    await db.insert(yearTournaments).values([
      yearOf({ status: 'finished', outcome: 'no_award' }),
      yearOf({
        id: '01JD0000000000000000000Y02',
        year: 2028,
        status: 'finished',
        outcome: 'awarded',
        championEntryId: '01JD0000000000000000000E99',
      }),
    ]);

    expect(await db.$count(yearTournaments)).toBe(2);
  });

  test('ブラケットのIDは存在するブラケットだけを参照でき、管理者のIDは外部キーを持たない', async () => {
    expect(
      await rejectionMessagesOf(
        db.insert(yearTournaments).values(yearOf({ bracketId: BRACKET_ID })),
      ),
    ).toContainEqual(expect.stringContaining('FOREIGN KEY constraint failed'));

    await db.insert(tournamentBrackets).values({
      id: BRACKET_ID,
      kind: 'year',
      tournamentId: YEAR_TOURNAMENT_ID,
      participantCount: 2,
      seedCount: 0,
      secondRoundSize: 0,
      roundCount: 1,
      status: 'active',
    });
    await db.insert(yearTournaments).values(
      yearOf({
        bracketId: BRACKET_ID,
        finalDateSource: 'explicit',
        finalDateVersion: 1,
        finalDateUpdatedByAdminId: '01JD0000000000000000000A99',
      }),
    );

    expect(await db.$count(yearTournaments)).toBe(1);
  });
});

describe('参加の枠の制約', () => {
  test.each(['entitled', 'drawn'] as const)(
    '%sの枠は参加資格の出どころが無いと作れない',
    async (status) => {
      expect(
        await rejectionMessagesOf(
          db.insert(yearTournamentEntries).values(
            entryOf('01JD0000000000000000000E01', {
              status,
              classifiedYear: 2027,
            }),
          ),
        ),
      ).toContainEqual(
        expect.stringContaining(
          'CHECK constraint failed: year_tournament_entries_entitled_source_check',
        ),
      );
    },
  );

  test('決済で得た参加資格は購入のIDが無いと作れない', async () => {
    expect(
      await rejectionMessagesOf(
        db.insert(yearTournamentEntries).values(
          entryOf('01JD0000000000000000000E01', {
            status: 'entitled',
            entitlementSource: 'payment',
          }),
        ),
      ),
    ).toContainEqual(
      expect.stringContaining(
        'CHECK constraint failed: year_tournament_entries_payment_purchase_check',
      ),
    );
  });

  test.each([
    ['drawn', null, 'ultras'],
    ['excluded', 'over_capacity', 'ultras'],
    ['expired', 'late_entry', null],
  ] as const)(
    '%s(理由%s)の枠は終えた年が無いと作れない',
    async (status, closeReason, entitlementSource) => {
      expect(
        await rejectionMessagesOf(
          db.insert(yearTournamentEntries).values(
            entryOf('01JD0000000000000000000E01', {
              status,
              closeReason,
              entitlementSource,
            }),
          ),
        ),
      ).toContainEqual(
        expect.stringContaining(
          'CHECK constraint failed: year_tournament_entries_classified_year_check',
        ),
      );
    },
  );

  test('組み合わせに入った枠・上限で除いた枠・遅れた枠は終えた年があれば作れ、期限切れと喪失の枠は終えた年が無くても作れる', async () => {
    await db.insert(yearTournamentEntries).values([
      entryOf('01JD0000000000000000000E01', {
        status: 'drawn',
        entitlementSource: 'ultras',
        classifiedYear: 2027,
      }),
      entryOf('01JD0000000000000000000E02', {
        weekTournamentId: '01JD0000000000000000000W02',
        launchId: SECOND_LAUNCH_ID,
        status: 'excluded',
        entitlementSource: 'payment',
        purchaseId: '01JD0000000000000000000Q01',
        closeReason: 'over_capacity',
        classifiedYear: 2027,
        refundStatus: 'pending',
      }),
      entryOf('01JD0000000000000000000E03', {
        weekTournamentId: '01JD0000000000000000000W03',
        launchId: null,
        status: 'expired',
        closeReason: 'late_entry',
        classifiedYear: 2027,
        refundStatus: 'not_needed',
      }),
      entryOf('01JD0000000000000000000E04', {
        weekTournamentId: '01JD0000000000000000000W04',
        launchId: null,
        status: 'expired',
        closeReason: 'deadline',
      }),
      entryOf('01JD0000000000000000000E05', {
        weekTournamentId: '01JD0000000000000000000W05',
        launchId: null,
        status: 'forfeited',
        closeReason: 'deleted',
      }),
    ]);

    expect(await db.$count(yearTournamentEntries)).toBe(5);
  });

  test('Ultrasで得た参加資格は購入のIDが無くても作れ、返金と知らせの状態の既定はnoneになる', async () => {
    await db.insert(yearTournamentEntries).values(
      entryOf('01JD0000000000000000000E01', {
        status: 'entitled',
        entitlementSource: 'ultras',
      }),
    );

    const rows = await db
      .select({
        refundStatus: yearTournamentEntries.refundStatus,
        refundNoticeStatus: yearTournamentEntries.refundNoticeStatus,
      })
      .from(yearTournamentEntries);

    expect(rows).toEqual([
      { refundStatus: 'none', refundNoticeStatus: 'none' },
    ]);
  });

  test('返金の状態は返金済みと拒否を含む6つの値に限る', async () => {
    await db.insert(yearTournamentEntries).values(
      entryOf('01JD0000000000000000000E01', {
        refundStatus: 'already_refunded',
      }),
    );
    await db
      .update(yearTournamentEntries)
      .set({ refundStatus: 'rejected' })
      .where(eq(yearTournamentEntries.id, '01JD0000000000000000000E01'));

    expect(
      await rejectionMessagesOf(
        db
          .update(yearTournamentEntries)
          .set({ refundStatus: 'refunded' as 'rejected' })
          .where(eq(yearTournamentEntries.id, '01JD0000000000000000000E01')),
      ),
    ).toContainEqual(
      expect.stringContaining(
        'CHECK constraint failed: year_tournament_entries_refund_status_check',
      ),
    );
  });

  test('知らせの状態は4つの値に限る', async () => {
    expect(
      await rejectionMessagesOf(
        db.insert(yearTournamentEntries).values(
          entryOf('01JD0000000000000000000E01', {
            refundNoticeStatus: 'failed' as 'sent',
          }),
        ),
      ),
    ).toContainEqual(
      expect.stringContaining(
        'CHECK constraint failed: year_tournament_entries_refund_notice_status_check',
      ),
    );
  });
});

describe('参加の枠の一意索引と紐付け', () => {
  test('同じWeek優勝の枠を2つ作れない', async () => {
    await db
      .insert(yearTournamentEntries)
      .values(entryOf('01JD0000000000000000000E01'));

    expect(
      await rejectionMessagesOf(
        db.insert(yearTournamentEntries).values(
          entryOf('01JD0000000000000000000E02', {
            launchId: SECOND_LAUNCH_ID,
          }),
        ),
      ),
    ).toContainEqual(
      expect.stringContaining(
        'UNIQUE constraint failed: year_tournament_entries.week_tournament_id',
      ),
    );
  });

  test('同じローンチの枠を2つ作れない', async () => {
    await db
      .insert(yearTournamentEntries)
      .values(entryOf('01JD0000000000000000000E01'));

    expect(
      await rejectionMessagesOf(
        db.insert(yearTournamentEntries).values(
          entryOf('01JD0000000000000000000E02', {
            weekTournamentId: '01JD0000000000000000000W02',
          }),
        ),
      ),
    ).toContainEqual(
      expect.stringContaining(
        'UNIQUE constraint failed: year_tournament_entries.launch_id',
      ),
    );
  });

  test('紐付けを解除した枠はいくつでも残せ、Week優勝の行が無くても作れる', async () => {
    await db.insert(yearTournamentEntries).values([
      entryOf('01JD0000000000000000000E01', {
        launchId: null,
        productId: null,
        ownerUserId: null,
      }),
      entryOf('01JD0000000000000000000E02', {
        weekTournamentId: '01JD0000000000000000000W02',
        launchId: null,
        productId: null,
        ownerUserId: null,
      }),
    ]);

    expect(await db.$count(yearTournamentEntries)).toBe(2);
  });

  test('紐付けを残した枠があるとプロダクトと投稿者を物理削除できず、紐付けを解除すれば削除できる', async () => {
    await db
      .insert(yearTournamentEntries)
      .values(entryOf('01JD0000000000000000000E01'));

    expect(
      await rejectionMessagesOf(
        db.delete(productLaunches).where(eq(productLaunches.id, LAUNCH_ID)),
      ),
    ).toContainEqual(expect.stringContaining('FOREIGN KEY constraint failed'));

    await db
      .update(yearTournamentEntries)
      .set({ launchId: null, productId: null, ownerUserId: null })
      .where(eq(yearTournamentEntries.id, '01JD0000000000000000000E01'));
    await db.delete(productLaunches);
    await db.delete(products);
    await db.delete(users);

    expect(await db.$count(yearTournamentEntries)).toBe(1);
  });
});
