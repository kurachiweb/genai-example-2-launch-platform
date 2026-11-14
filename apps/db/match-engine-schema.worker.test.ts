import { env } from 'cloudflare:workers';
import { ne } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';

import { createDatabase } from './client.ts';
import { users } from './schema/identity/users.ts';
import { matchEntries } from './schema/match/match-entries.ts';
import { matchEventHandlerRuns } from './schema/match/match-event-handler-runs.ts';
import { matchEvents } from './schema/match/match-events.ts';
import { matchUpvotes } from './schema/match/match-upvotes.ts';
import { matches } from './schema/match/matches.ts';
import { qualifierPairings } from './schema/match/qualifier-pairings.ts';
import { productCategories } from './schema/product/product-categories.ts';
import { productLaunches } from './schema/product/product-launches.ts';
import { products } from './schema/product/products.ts';

const OTHER_CATEGORY_ID = '01JD0000000000000000000000';

const OWNER_ID = '01JD0000000000000000000U01';

const SUPPORTER_ID = '01JD0000000000000000000U02';

const PRODUCT_ID = '01JD0000000000000000000P01';

const LAUNCH_ID = '01JD0000000000000000000L01';

const MATCH_DATE = '2026-11-20';

const STARTS_AT = new Date(Date.UTC(2026, 10, 19, 15));

const ENDS_AT = new Date(Date.UTC(2026, 10, 20, 14, 40));

const AT = new Date(Date.UTC(2026, 10, 20));

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

async function insertMatch(
  id: string,
  kind: 'qualifier' | 'week' = 'qualifier',
): Promise<void> {
  await db.insert(matches).values({
    id,
    kind,
    matchDate: MATCH_DATE,
    round: kind === 'qualifier' ? null : 1,
    startsAt: STARTS_AT,
    endsAt: ENDS_AT,
  });
}

function entryOf(
  id: string,
  matchId: string,
  slot: number,
  kind: 'qualifier' | 'week' = 'qualifier',
) {
  return {
    id,
    matchId,
    slot,
    matchKind: kind,
    matchDate: MATCH_DATE,
    launchId: LAUNCH_ID,
    productId: PRODUCT_ID,
    ownerUserId: OWNER_ID,
  };
}

function upvoteOf(id: string, seq: number) {
  return {
    id,
    matchId: '01JD0000000000000000000M01',
    entryId: '01JD0000000000000000000N01',
    userId: SUPPORTER_ID,
    matchDate: MATCH_DATE,
    upvotedAt: AT,
    seq,
  };
}

beforeEach(async () => {
  await db.delete(matchEventHandlerRuns);
  await db.delete(matchEvents);
  await db.delete(matchUpvotes);
  await db.delete(matchEntries);
  await db.delete(matches);
  await db.delete(qualifierPairings);
  await db.delete(productLaunches);
  await db.delete(products);
  await db
    .delete(productCategories)
    .where(ne(productCategories.id, OTHER_CATEGORY_ID));
  await db.delete(users);
  await db.insert(users).values(
    [OWNER_ID, SUPPORTER_ID].map((id, index) => ({
      id,
      pseudonymousId: `pseudonymous-${String(index)}`,
      email: `user${String(index)}@launch.example`,
      passwordHash: 'hash',
      nickname: `利用者${String(index)}`,
      handle: `user${String(index)}`,
      termsAgreedAt: AT,
    })),
  );
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
    latestLaunchDate: MATCH_DATE,
  });
  await db.insert(productLaunches).values({
    id: LAUNCH_ID,
    productId: PRODUCT_ID,
    launchDate: MATCH_DATE,
  });
});

describe('Upvoteの部分一意索引', () => {
  beforeEach(async () => {
    await insertMatch('01JD0000000000000000000M01');
    await db
      .insert(matchEntries)
      .values(
        entryOf('01JD0000000000000000000N01', '01JD0000000000000000000M01', 1),
      );
  });

  test('有効なUpvoteを同じマッチと利用者で2つ作れない', async () => {
    await db
      .insert(matchUpvotes)
      .values(upvoteOf('01JD0000000000000000000V01', 1));

    expect(
      await rejectionMessagesOf(
        db
          .insert(matchUpvotes)
          .values(upvoteOf('01JD0000000000000000000V02', 2)),
      ),
    ).toContainEqual(
      expect.stringContaining(
        'UNIQUE constraint failed: match_upvotes.match_id, match_upvotes.user_id',
      ),
    );
  });

  test('論理削除したUpvoteは数えず、同じマッチと利用者で改めてUpvoteを作れる', async () => {
    await db.insert(matchUpvotes).values({
      ...upvoteOf('01JD0000000000000000000V01', 1),
      deletedAt: AT,
    });

    await db
      .insert(matchUpvotes)
      .values(upvoteOf('01JD0000000000000000000V02', 2));

    expect(await db.$count(matchUpvotes)).toBe(2);
  });
});

describe('予選の側のローンチの部分一意索引', () => {
  test('同じローンチの予選の側を2つ作れない', async () => {
    await insertMatch('01JD0000000000000000000M01');
    await insertMatch('01JD0000000000000000000M02');
    await db
      .insert(matchEntries)
      .values(
        entryOf('01JD0000000000000000000N01', '01JD0000000000000000000M01', 1),
      );

    expect(
      await rejectionMessagesOf(
        db
          .insert(matchEntries)
          .values(
            entryOf(
              '01JD0000000000000000000N02',
              '01JD0000000000000000000M02',
              1,
            ),
          ),
      ),
    ).toContainEqual(
      expect.stringContaining(
        'UNIQUE constraint failed: match_entries.launch_id',
      ),
    );
  });

  test('トーナメントの側と紐付けを解除した予選の側は数えない', async () => {
    await insertMatch('01JD0000000000000000000M01');
    await insertMatch('01JD0000000000000000000M02', 'week');
    await insertMatch('01JD0000000000000000000M03');

    await db.insert(matchEntries).values([
      entryOf('01JD0000000000000000000N01', '01JD0000000000000000000M01', 1),
      entryOf(
        '01JD0000000000000000000N02',
        '01JD0000000000000000000M02',
        1,
        'week',
      ),
      {
        ...entryOf(
          '01JD0000000000000000000N03',
          '01JD0000000000000000000M01',
          2,
        ),
        launchId: null,
        productId: null,
        ownerUserId: null,
        unlinkedAt: AT,
      },
      {
        ...entryOf(
          '01JD0000000000000000000N04',
          '01JD0000000000000000000M03',
          1,
        ),
        launchId: null,
        productId: null,
        ownerUserId: null,
        unlinkedAt: AT,
      },
    ]);

    expect(await db.$count(matchEntries)).toBe(4);
  });

  test('同じマッチの同じ側の番号に2つの側を置けず、側の番号は1・2だけを受け付ける', async () => {
    await insertMatch('01JD0000000000000000000M01', 'week');
    await db
      .insert(matchEntries)
      .values(
        entryOf(
          '01JD0000000000000000000N01',
          '01JD0000000000000000000M01',
          1,
          'week',
        ),
      );

    expect(
      await rejectionMessagesOf(
        db
          .insert(matchEntries)
          .values(
            entryOf(
              '01JD0000000000000000000N02',
              '01JD0000000000000000000M01',
              1,
              'week',
            ),
          ),
      ),
    ).toContainEqual(
      expect.stringContaining(
        'UNIQUE constraint failed: match_entries.match_id, match_entries.slot',
      ),
    );
    expect(
      await rejectionMessagesOf(
        db
          .insert(matchEntries)
          .values(
            entryOf(
              '01JD0000000000000000000N03',
              '01JD0000000000000000000M01',
              3,
              'week',
            ),
          ),
      ),
    ).toContainEqual(
      expect.stringContaining(
        'CHECK constraint failed: match_entries_slot_check',
      ),
    );
  });
});

describe('マッチの開始と終了', () => {
  test('開始が終了より前でないマッチを拒否する', async () => {
    expect(
      await rejectionMessagesOf(
        db.insert(matches).values({
          kind: 'qualifier',
          matchDate: MATCH_DATE,
          startsAt: ENDS_AT,
          endsAt: ENDS_AT,
        }),
      ),
    ).toContainEqual(
      expect.stringContaining(
        'CHECK constraint failed: matches_starts_before_ends_check',
      ),
    );
  });
});

describe('マッチイベントとペアリングの記録の一意索引', () => {
  test('同じマッチの同じ種類のイベントを2つ作れない', async () => {
    await insertMatch('01JD0000000000000000000M01');
    const event = {
      matchId: '01JD0000000000000000000M01',
      matchKind: 'qualifier' as const,
      type: 'decided' as const,
      occurredAt: AT,
      lastDispatchedAt: AT,
    };
    await db.insert(matchEvents).values(event);

    expect(
      await rejectionMessagesOf(db.insert(matchEvents).values(event)),
    ).toContainEqual(
      expect.stringContaining(
        'UNIQUE constraint failed: match_events.match_id, match_events.type',
      ),
    );
  });

  test('同じ実施日のペアリングの記録を2つ作れない', async () => {
    await db.insert(qualifierPairings).values({ matchDate: MATCH_DATE });

    expect(
      await rejectionMessagesOf(
        db.insert(qualifierPairings).values({ matchDate: MATCH_DATE }),
      ),
    ).toContainEqual(
      expect.stringContaining(
        'UNIQUE constraint failed: qualifier_pairings.match_date',
      ),
    );
  });
});
