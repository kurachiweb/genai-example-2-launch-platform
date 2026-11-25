import { env } from 'cloudflare:workers';
import { eq, ne } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';

import { createDatabase } from './client.ts';
import { users } from './schema/identity/users.ts';
import { productCategories } from './schema/product/product-categories.ts';
import { productLaunches } from './schema/product/product-launches.ts';
import { products } from './schema/product/products.ts';
import { bracketMatches } from './schema/tournament/bracket-matches.ts';
import { bracketParticipants } from './schema/tournament/bracket-participants.ts';
import { tournamentBrackets } from './schema/tournament/tournament-brackets.ts';
import { weekTournamentEntries } from './schema/tournament/week-tournament-entries.ts';
import { weekTournaments } from './schema/tournament/week-tournaments.ts';

const OTHER_CATEGORY_ID = '01JD0000000000000000000000';

const OWNER_ID = '01JD0000000000000000000U01';

const PRODUCT_ID = '01JD0000000000000000000P01';

const LAUNCH_ID = '01JD0000000000000000000L01';

const SECOND_LAUNCH_ID = '01JD0000000000000000000L02';

const TOURNAMENT_ID = '01JD0000000000000000000W01';

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

function entryOf(
  id: string,
  overrides: Partial<typeof weekTournamentEntries.$inferInsert> = {},
): typeof weekTournamentEntries.$inferInsert {
  return {
    id,
    tournamentId: TOURNAMENT_ID,
    launchId: LAUNCH_ID,
    productId: PRODUCT_ID,
    ownerUserId: OWNER_ID,
    launchDate: LAUNCH_DATE,
    qualifierMatchId: '01JD0000000000000000000M01',
    qualifierUpvoteCount: 3,
    qualifierLastUpvoteElapsedMs: 1000,
    wonAt: AT,
    status: 'awaiting_payment',
    ...overrides,
  };
}

function bracketOf(
  overrides: Partial<typeof tournamentBrackets.$inferInsert> = {},
): typeof tournamentBrackets.$inferInsert {
  return {
    id: BRACKET_ID,
    kind: 'week',
    tournamentId: TOURNAMENT_ID,
    participantCount: 2,
    seedCount: 0,
    secondRoundSize: 0,
    roundCount: 1,
    status: 'active',
    ...overrides,
  };
}

beforeEach(async () => {
  await db.delete(bracketMatches);
  await db.delete(bracketParticipants);
  await db.delete(weekTournamentEntries);
  await db.delete(weekTournaments);
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
  await db.insert(weekTournaments).values({
    id: TOURNAMENT_ID,
    weekStart: LAUNCH_DATE,
    acceptUntil: AT,
    deadlineAt: AT,
    drawAt: AT,
    status: 'open',
  });
});

describe('参加の枠の参加資格の制約', () => {
  test.each(['entitled', 'drawn'] as const)(
    '%sの枠は参加資格の出どころが無いと作れない',
    async (status) => {
      expect(
        await rejectionMessagesOf(
          db
            .insert(weekTournamentEntries)
            .values(entryOf('01JD0000000000000000000E01', { status })),
        ),
      ).toContainEqual(
        expect.stringContaining(
          'CHECK constraint failed: week_tournament_entries_entitled_source_check',
        ),
      );
    },
  );

  test('決済で得た参加資格は購入のIDが無いと作れない', async () => {
    expect(
      await rejectionMessagesOf(
        db.insert(weekTournamentEntries).values(
          entryOf('01JD0000000000000000000E01', {
            status: 'entitled',
            entitlementSource: 'payment',
          }),
        ),
      ),
    ).toContainEqual(
      expect.stringContaining(
        'CHECK constraint failed: week_tournament_entries_payment_purchase_check',
      ),
    );
  });

  test('Ultrasで得た参加資格は購入のIDが無くても作れ、決済待ちの枠は出どころが無くても作れる', async () => {
    await db.insert(weekTournamentEntries).values([
      entryOf('01JD0000000000000000000E01', {
        status: 'entitled',
        entitlementSource: 'ultras',
      }),
      entryOf('01JD0000000000000000000E02', {
        launchId: SECOND_LAUNCH_ID,
        productId: null,
      }),
    ]);

    const rows = await db
      .select({
        refundStatus: weekTournamentEntries.refundStatus,
        refundNoticeStatus: weekTournamentEntries.refundNoticeStatus,
      })
      .from(weekTournamentEntries);

    expect(rows).toEqual([
      { refundStatus: 'none', refundNoticeStatus: 'none' },
      { refundStatus: 'none', refundNoticeStatus: 'none' },
    ]);
  });

  test('返金の状態は6つの値に限る', async () => {
    await db.insert(weekTournamentEntries).values(
      entryOf('01JD0000000000000000000E01', {
        refundStatus: 'already_refunded',
      }),
    );

    expect(
      await rejectionMessagesOf(
        db
          .update(weekTournamentEntries)
          .set({ refundStatus: 'refunded' as 'rejected' })
          .where(eq(weekTournamentEntries.id, '01JD0000000000000000000E01')),
      ),
    ).toContainEqual(
      expect.stringContaining(
        'CHECK constraint failed: week_tournament_entries_refund_status_check',
      ),
    );
  });
});

describe('参加の枠の一意索引', () => {
  test('同じローンチの枠を2つ作れない', async () => {
    await db
      .insert(weekTournamentEntries)
      .values(entryOf('01JD0000000000000000000E01'));

    expect(
      await rejectionMessagesOf(
        db
          .insert(weekTournamentEntries)
          .values(entryOf('01JD0000000000000000000E02', { productId: null })),
      ),
    ).toContainEqual(
      expect.stringContaining(
        'UNIQUE constraint failed: week_tournament_entries.launch_id',
      ),
    );
  });

  test('同じ週に同じプロダクトの枠を2つ作れない', async () => {
    await db
      .insert(weekTournamentEntries)
      .values(entryOf('01JD0000000000000000000E01'));

    expect(
      await rejectionMessagesOf(
        db.insert(weekTournamentEntries).values(
          entryOf('01JD0000000000000000000E02', {
            launchId: SECOND_LAUNCH_ID,
          }),
        ),
      ),
    ).toContainEqual(
      expect.stringContaining(
        'UNIQUE constraint failed: week_tournament_entries.tournament_id, week_tournament_entries.product_id',
      ),
    );
  });

  test('紐付けを解除した枠は同じ週にいくつでも残せる', async () => {
    await db.insert(weekTournamentEntries).values([
      entryOf('01JD0000000000000000000E01', {
        launchId: null,
        productId: null,
        ownerUserId: null,
      }),
      entryOf('01JD0000000000000000000E02', {
        launchId: null,
        productId: null,
        ownerUserId: null,
      }),
    ]);

    expect(await db.$count(weekTournamentEntries)).toBe(2);
  });
});

describe('ブラケットの制約', () => {
  test('終了したブラケットは結果が無いと作れない', async () => {
    expect(
      await rejectionMessagesOf(
        db.insert(tournamentBrackets).values(bracketOf({ status: 'finished' })),
      ),
    ).toContainEqual(
      expect.stringContaining(
        'CHECK constraint failed: tournament_brackets_finished_outcome_check',
      ),
    );
  });

  test('優勝の結果は優勝者の番号が無いと作れない', async () => {
    expect(
      await rejectionMessagesOf(
        db
          .insert(tournamentBrackets)
          .values(bracketOf({ status: 'finished', outcome: 'champion' })),
      ),
    ).toContainEqual(
      expect.stringContaining(
        'CHECK constraint failed: tournament_brackets_champion_participant_check',
      ),
    );
  });

  test('授与なしで終了したブラケットは優勝者の番号が無くても作れる', async () => {
    await db
      .insert(tournamentBrackets)
      .values(bracketOf({ status: 'finished', outcome: 'no_award' }));

    expect(await db.$count(tournamentBrackets)).toBe(1);
  });

  test('同じ種類とトーナメントのブラケットを2つ作れない', async () => {
    await db.insert(tournamentBrackets).values(bracketOf());

    expect(
      await rejectionMessagesOf(
        db
          .insert(tournamentBrackets)
          .values(bracketOf({ id: '01JD0000000000000000000B02' })),
      ),
    ).toContainEqual(
      expect.stringContaining(
        'UNIQUE constraint failed: tournament_brackets.kind, tournament_brackets.tournament_id',
      ),
    );
  });

  test('マッチの行が無くてもブラケットのマッチを予定前として作れ、同じ位置のマッチは2つ作れない', async () => {
    await db.insert(tournamentBrackets).values(bracketOf());
    const matchOf = (matchId: string) => ({
      matchId,
      bracketId: BRACKET_ID,
      round: 1,
      position: 1,
      matchDate: '2026-11-24',
      participant1No: 1,
      participant2No: 2,
      status: 'planned' as const,
    });
    await db
      .insert(bracketMatches)
      .values(matchOf('01JD0000000000000000000M11'));

    expect(
      await rejectionMessagesOf(
        db.insert(bracketMatches).values(matchOf('01JD0000000000000000000M12')),
      ),
    ).toContainEqual(
      expect.stringContaining(
        'UNIQUE constraint failed: bracket_matches.bracket_id, bracket_matches.round, bracket_matches.position',
      ),
    );
  });

  test('同じブラケットで参加者の番号と枠の参照はそれぞれ重複できない', async () => {
    await db.insert(tournamentBrackets).values(bracketOf());
    await db.insert(bracketParticipants).values({
      bracketId: BRACKET_ID,
      participantNo: 1,
      entryRef: 'entry-1',
    });

    expect(
      await rejectionMessagesOf(
        db.insert(bracketParticipants).values({
          bracketId: BRACKET_ID,
          participantNo: 1,
          entryRef: 'entry-2',
        }),
      ),
    ).toContainEqual(
      expect.stringContaining(
        'UNIQUE constraint failed: bracket_participants.bracket_id, bracket_participants.participant_no',
      ),
    );
    expect(
      await rejectionMessagesOf(
        db.insert(bracketParticipants).values({
          bracketId: BRACKET_ID,
          participantNo: 2,
          entryRef: 'entry-1',
        }),
      ),
    ).toContainEqual(
      expect.stringContaining(
        'UNIQUE constraint failed: bracket_participants.bracket_id, bracket_participants.entry_ref',
      ),
    );
  });
});
