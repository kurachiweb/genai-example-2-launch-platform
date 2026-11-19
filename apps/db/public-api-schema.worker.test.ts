import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';

import { createDatabase } from './client.ts';
import { users } from './schema/identity/users.ts';
import { apiKeys } from './schema/public-api/api-keys.ts';

const USER_ID = '01JP0000000000000000000U01';

const MISSING_USER_ID = '01JP0000000000000000000U99';

const API_KEY_ID = '01JP0000000000000000000K01';

const KEY_HASH = 'a'.repeat(86);

const AT = new Date(Date.UTC(2026, 10, 19));

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

function apiKeyOf(
  overrides: Partial<typeof apiKeys.$inferInsert> = {},
): typeof apiKeys.$inferInsert {
  return {
    id: API_KEY_ID,
    userId: USER_ID,
    name: '自分のツール',
    keyHash: KEY_HASH,
    scopeProducts: 'read',
    scopeLaunches: 'read',
    scopeUpvotes: 'read',
    scopeComments: 'read',
    scopeRatings: 'read',
    scopeProfile: 'none',
    scopeProductDescriptions: 'none',
    ...overrides,
  };
}

// 型で拒まれる値をD1へ渡すため、Drizzleを通さずに挿入の文を組み立てる
function insertWithScope(column: string, value: string): Promise<unknown> {
  const scopes = {
    scope_products: 'read',
    scope_launches: 'read',
    scope_upvotes: 'read',
    scope_comments: 'read',
    scope_ratings: 'read',
    scope_profile: 'none',
    scope_product_descriptions: 'none',
    [column]: value,
  };
  const columns = Object.keys(scopes);
  return env.DB.prepare(
    `INSERT INTO api_keys (id, user_id, name, key_hash, ${columns.join(', ')}, created_at, updated_at) VALUES (?, ?, ?, ?, ${columns.map(() => '?').join(', ')}, 0, 0)`,
  )
    .bind(
      API_KEY_ID,
      USER_ID,
      '自分のツール',
      KEY_HASH,
      ...Object.values(scopes),
    )
    .run();
}

beforeEach(async () => {
  await db.delete(apiKeys);
  await db.delete(users);
  await db.insert(users).values({
    id: USER_ID,
    pseudonymousId: 'pseudonymous-0',
    email: 'user0@launch.example',
    passwordHash: 'hash',
    nickname: '利用者0',
    handle: 'user0',
    termsAgreedAt: AT,
  });
});

describe('APIキーの制約', () => {
  test('読み書きを許す2機能に読み書きを指定したキーを作れる', async () => {
    await db.insert(apiKeys).values(
      apiKeyOf({
        scopeProfile: 'read_write',
        scopeProductDescriptions: 'read_write',
      }),
    );

    const rows = await db
      .select({
        scopeProfile: apiKeys.scopeProfile,
        scopeProductDescriptions: apiKeys.scopeProductDescriptions,
      })
      .from(apiKeys);

    expect(rows).toEqual([
      { scopeProfile: 'read_write', scopeProductDescriptions: 'read_write' },
    ]);
  });

  test('同じ利用者が同じ名前と権限スコープのキーを複数持てる', async () => {
    await db.insert(apiKeys).values([
      apiKeyOf(),
      apiKeyOf({
        id: '01JP0000000000000000000K02',
        keyHash: 'b'.repeat(86),
      }),
    ]);

    expect(await db.$count(apiKeys, eq(apiKeys.userId, USER_ID))).toBe(2);
  });

  test.each([
    'scope_products',
    'scope_launches',
    'scope_upvotes',
    'scope_comments',
    'scope_ratings',
  ])(
    '読み取りだけの機能の%sに読み書きを指定したキーは作れない',
    async (column) => {
      expect(
        await rejectionMessagesOf(insertWithScope(column, 'read_write')),
      ).toContainEqual(
        expect.stringContaining(
          `CHECK constraint failed: api_keys_${column}_check`,
        ),
      );
    },
  );

  test.each([
    'scope_products',
    'scope_launches',
    'scope_upvotes',
    'scope_comments',
    'scope_ratings',
    'scope_profile',
    'scope_product_descriptions',
  ])('%sに未知の値を指定したキーは作れない', async (column) => {
    expect(
      await rejectionMessagesOf(insertWithScope(column, 'write')),
    ).toContainEqual(
      expect.stringContaining(
        `CHECK constraint failed: api_keys_${column}_check`,
      ),
    );
  });

  test('同じハッシュのキーは作れない', async () => {
    await db.insert(apiKeys).values(apiKeyOf());

    expect(
      await rejectionMessagesOf(
        db
          .insert(apiKeys)
          .values(apiKeyOf({ id: '01JP0000000000000000000K02' })),
      ),
    ).toContainEqual(
      expect.stringContaining('UNIQUE constraint failed: api_keys.key_hash'),
    );
  });

  test('存在しない利用者のキーは作れない', async () => {
    expect(
      await rejectionMessagesOf(
        db.insert(apiKeys).values(apiKeyOf({ userId: MISSING_USER_ID })),
      ),
    ).toContainEqual(expect.stringContaining('FOREIGN KEY constraint failed'));
  });

  test('キーが残る利用者は消せず、キーを先に消せば消せる', async () => {
    await db.insert(apiKeys).values(apiKeyOf());

    expect(
      await rejectionMessagesOf(db.delete(users).where(eq(users.id, USER_ID))),
    ).toContainEqual(expect.stringContaining('FOREIGN KEY constraint failed'));

    await db.delete(apiKeys).where(eq(apiKeys.userId, USER_ID));
    await db.delete(users).where(eq(users.id, USER_ID));

    expect(await db.$count(users)).toBe(0);
  });
});
