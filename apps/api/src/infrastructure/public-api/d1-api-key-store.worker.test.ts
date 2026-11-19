import { count, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';

import type { ApiKeyScopes } from '../../../common-lib/public-api/api-key-rules.ts';
import { users } from '../../../db/schema/identity/users.ts';
import { apiKeys } from '../../../db/schema/public-api/api-keys.ts';
import {
  after,
  createFailingDatabase,
  db,
  insertUser,
  T0,
  userIdOf,
} from '../../../lib/workers/identity/testing/identity-store-fixtures.ts';
import {
  apiKeyIdOf,
  clearApiKeyTables,
  insertApiKey,
  keyHashOf,
} from '../../../lib/workers/public-api/testing/api-key-fixtures.ts';
import type {
  ApiKeyListPosition,
  ApiKeyRecord,
  ApiKeyStore,
  NewApiKey,
} from '../../application/public-api/ports.ts';
import { D1ApiKeyStore } from './d1-api-key-store.ts';

const OWNER = 1;

const OTHER = 2;

const SUSPENDED = 3;

const WITHDRAWN = 4;

const UNLIMITED_KEY_COUNT = 60;

const ISSUED_SCOPES: ApiKeyScopes = Object.freeze({
  products: 'read',
  launches: 'none',
  upvotes: 'read',
  comments: 'none',
  ratings: 'read',
  profile: 'read_write',
  productDescriptions: 'read',
});

const EDITED_SCOPES: ApiKeyScopes = Object.freeze({
  products: 'none',
  launches: 'read',
  upvotes: 'none',
  comments: 'read',
  ratings: 'none',
  profile: 'read',
  productDescriptions: 'read_write',
});

function createStore(database = db): ApiKeyStore {
  return new D1ApiKeyStore(database);
}

function newKeyOf(
  index: number,
  userIndex: number,
  overrides: Partial<NewApiKey> = {},
): NewApiKey {
  return {
    id: apiKeyIdOf(index),
    userId: userIdOf(userIndex),
    name: `連携${String(index)}`,
    keyHash: keyHashOf(index),
    scopes: ISSUED_SCOPES,
    at: after(index * 1000),
    ...overrides,
  };
}

async function countKeysOf(userIndex: number): Promise<number> {
  const [row] = await db
    .select({ rows: count() })
    .from(apiKeys)
    .where(eq(apiKeys.userId, userIdOf(userIndex)));
  return row?.rows ?? 0;
}

async function readRow(index: number) {
  const [row] = await db
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.id, apiKeyIdOf(index)));
  return row;
}

// Drizzle ORMはD1の例外をcauseに包むため、連鎖をたどって制約の違反の文言を探す
function causeMessagesOf(error: unknown): string {
  const messages: string[] = [];
  let current: unknown = error;
  while (current instanceof Error) {
    messages.push(current.message);
    current = current.cause;
  }
  return messages.join('\n');
}

const idsOf = (records: readonly ApiKeyRecord[]): string[] =>
  records.map(({ id }) => id);

async function readAllPages(
  store: ApiKeyStore,
  userIndex: number,
  limit: number,
): Promise<string[][]> {
  const pages: string[][] = [];
  let before: ApiKeyListPosition | undefined;
  for (;;) {
    const records = await store.listByUser(userIdOf(userIndex), {
      limit,
      before,
    });
    if (records.length === 0) {
      return pages;
    }
    pages.push(idsOf(records));
    const last = records.at(-1);
    before =
      last === undefined
        ? undefined
        : { createdAt: last.createdAt, id: last.id };
  }
}

beforeEach(async () => {
  await clearApiKeyTables();
  await insertUser(OWNER);
  await insertUser(OTHER);
  await insertUser(SUSPENDED, { status: 'suspended' });
  await insertUser(WITHDRAWN, { deletedAt: T0 });
});

describe('D1ApiKeyStore: ハッシュでの照合', () => {
  test('保存したハッシュでキーを引き、ID・利用者・名前・camelCaseの権限スコープ・発行日時を返す', async () => {
    await insertApiKey(1, OWNER, {
      name: '連携用',
      scopeProducts: 'read',
      scopeLaunches: 'none',
      scopeUpvotes: 'read',
      scopeComments: 'none',
      scopeRatings: 'read',
      scopeProfile: 'read_write',
      scopeProductDescriptions: 'read',
      createdAt: after(500),
      updatedAt: after(9000),
    });

    await expect(createStore().findByHash(keyHashOf(1))).resolves.toEqual({
      id: apiKeyIdOf(1),
      userId: userIdOf(OWNER),
      name: '連携用',
      scopes: ISSUED_SCOPES,
      createdAt: after(500),
    });
  });

  test('一致するハッシュが無ければundefinedを返す', async () => {
    await insertApiKey(1, OWNER);

    await expect(
      createStore().findByHash('unknown-api-key-hash'),
    ).resolves.toBeUndefined();
  });

  test('結果に平文もハッシュも含めない', async () => {
    await insertApiKey(1, OWNER);

    const record = await createStore().findByHash(keyHashOf(1));

    expect(Object.keys(record ?? {}).toSorted()).toEqual(
      ['createdAt', 'id', 'name', 'scopes', 'userId'].toSorted(),
    );
    expect(JSON.stringify(record)).not.toContain(keyHashOf(1));
  });

  test('D1への問い合わせに失敗したら例外にする', async () => {
    await expect(
      createStore(createFailingDatabase()).findByHash(keyHashOf(1)),
    ).rejects.toThrow();
  });
});

describe('D1ApiKeyStore: 持ち主と組での照会', () => {
  test('本人のキーを返す', async () => {
    await insertApiKey(1, OWNER, { createdAt: after(100) });

    const record = await createStore().findForOwner(
      userIdOf(OWNER),
      apiKeyIdOf(1),
    );

    expect(record?.id).toBe(apiKeyIdOf(1));
    expect(record?.userId).toBe(userIdOf(OWNER));
    expect(record?.createdAt).toEqual(after(100));
  });

  test('他人のキーを本人のキーとして引くと見つからない', async () => {
    await insertApiKey(1, OTHER);

    await expect(
      createStore().findForOwner(userIdOf(OWNER), apiKeyIdOf(1)),
    ).resolves.toBeUndefined();
  });

  test('存在しないキーは見つからない', async () => {
    await expect(
      createStore().findForOwner(userIdOf(OWNER), apiKeyIdOf(99)),
    ).resolves.toBeUndefined();
  });
});

describe('D1ApiKeyStore: 発行の保存', () => {
  test('有効な利用者のキーを保存し、ハッシュで照合できる', async () => {
    const store = createStore();

    await expect(store.insert(newKeyOf(1, OWNER))).resolves.toBe('saved');

    await expect(store.findByHash(keyHashOf(1))).resolves.toEqual({
      id: apiKeyIdOf(1),
      userId: userIdOf(OWNER),
      name: '連携1',
      scopes: ISSUED_SCOPES,
      createdAt: after(1000),
    });
    const row = await readRow(1);
    expect(row?.keyHash).toBe(keyHashOf(1));
    expect(row?.updatedAt).toEqual(after(1000));
  });

  test.each([
    { label: '停止中', userIndex: SUSPENDED },
    { label: '退会済み', userIndex: WITHDRAWN },
    { label: '存在しない', userIndex: 9 },
  ])(
    '$labelの利用者のキーは保存せずaccount-unavailableを返す',
    async ({ userIndex }) => {
      await expect(createStore().insert(newKeyOf(1, userIndex))).resolves.toBe(
        'account-unavailable',
      );

      expect(await readRow(1)).toBeUndefined();
    },
  );

  test('同じ名前と権限スコープのキーを重ねて保存でき、元のキーと新しいキーの両方で照合できる', async () => {
    const store = createStore();
    await store.insert(newKeyOf(1, OWNER, { name: '同じ名前' }));

    await expect(
      store.insert(newKeyOf(2, OWNER, { name: '同じ名前' })),
    ).resolves.toBe('saved');

    const original = await store.findByHash(keyHashOf(1));
    const reissued = await store.findByHash(keyHashOf(2));
    expect(original?.id).toBe(apiKeyIdOf(1));
    expect(reissued?.id).toBe(apiKeyIdOf(2));
    expect(reissued?.name).toBe(original?.name);
    expect(reissued?.scopes).toEqual(original?.scopes);
  });

  test('1人の利用者のキーの数に上限が無い', async () => {
    const store = createStore();

    for (let index = 1; index <= UNLIMITED_KEY_COUNT; index += 1) {
      await expect(store.insert(newKeyOf(index, OWNER))).resolves.toBe('saved');
    }

    expect(await countKeysOf(OWNER)).toBe(UNLIMITED_KEY_COUNT);
  });

  test('D1の失敗はaccount-unavailableにせず例外にする', async () => {
    await expect(
      createStore(createFailingDatabase()).insert(newKeyOf(1, OWNER)),
    ).rejects.toThrow();
  });
});

describe('D1ApiKeyStore: 編集', () => {
  test('本人のキーの名前・権限スコープ・更新日時を変え、ハッシュと発行日時を変えない', async () => {
    await insertApiKey(1, OWNER, { createdAt: after(100) });
    const store = createStore();

    await expect(
      store.update({
        userId: userIdOf(OWNER),
        keyId: apiKeyIdOf(1),
        name: '変えた名前',
        scopes: EDITED_SCOPES,
        at: after(5000),
      }),
    ).resolves.toBe('updated');

    await expect(store.findByHash(keyHashOf(1))).resolves.toEqual({
      id: apiKeyIdOf(1),
      userId: userIdOf(OWNER),
      name: '変えた名前',
      scopes: EDITED_SCOPES,
      createdAt: after(100),
    });
    expect((await readRow(1))?.updatedAt).toEqual(after(5000));
  });

  test('他人のキーは変えずにnot-foundを返す', async () => {
    await insertApiKey(1, OTHER, { name: '他人のキー' });

    await expect(
      createStore().update({
        userId: userIdOf(OWNER),
        keyId: apiKeyIdOf(1),
        name: '乗っ取り',
        scopes: EDITED_SCOPES,
        at: after(5000),
      }),
    ).resolves.toBe('not-found');

    expect((await readRow(1))?.name).toBe('他人のキー');
  });

  test('存在しないキーはnot-foundを返す', async () => {
    await expect(
      createStore().update({
        userId: userIdOf(OWNER),
        keyId: apiKeyIdOf(99),
        name: '名前',
        scopes: EDITED_SCOPES,
        at: after(5000),
      }),
    ).resolves.toBe('not-found');
  });
});

describe('D1ApiKeyStore: 削除', () => {
  test('本人のキーを削除して真を返し、以後ハッシュで照合できない', async () => {
    await insertApiKey(1, OWNER);
    await insertApiKey(2, OWNER);
    const store = createStore();

    await expect(store.delete(userIdOf(OWNER), apiKeyIdOf(1))).resolves.toBe(
      true,
    );

    await expect(store.findByHash(keyHashOf(1))).resolves.toBeUndefined();
    expect((await store.findByHash(keyHashOf(2)))?.id).toBe(apiKeyIdOf(2));
  });

  test('他人のキーは削除せず偽を返す', async () => {
    await insertApiKey(1, OTHER);

    await expect(
      createStore().delete(userIdOf(OWNER), apiKeyIdOf(1)),
    ).resolves.toBe(false);

    expect(await readRow(1)).toBeDefined();
  });

  test('存在しないキーは偽を返す', async () => {
    await expect(
      createStore().delete(userIdOf(OWNER), apiKeyIdOf(99)),
    ).resolves.toBe(false);
  });
});

describe('D1ApiKeyStore: 一覧', () => {
  test('本人のキーだけを発行の新しい順にlimit件ずつ返し、位置より後から続ける', async () => {
    await insertApiKey(1, OWNER, { createdAt: after(1000) });
    await insertApiKey(2, OWNER, { createdAt: after(3000) });
    await insertApiKey(3, OTHER, { createdAt: after(2500) });
    await insertApiKey(4, OWNER, { createdAt: after(2000) });
    await insertApiKey(5, OWNER, { createdAt: after(4000) });

    expect(await readAllPages(createStore(), OWNER, 2)).toEqual([
      [apiKeyIdOf(5), apiKeyIdOf(2)],
      [apiKeyIdOf(4), apiKeyIdOf(1)],
    ]);
  });

  test('発行日時が同じキーはIDの降順に並べ、limitが1でも漏れなく重複なく返す', async () => {
    await insertApiKey(1, OWNER, { createdAt: after(1000) });
    await insertApiKey(2, OWNER, { createdAt: after(2000) });
    await insertApiKey(3, OWNER, { createdAt: after(2000) });
    await insertApiKey(4, OWNER, { createdAt: after(2000) });
    await insertApiKey(5, OWNER, { createdAt: after(500) });

    expect(await readAllPages(createStore(), OWNER, 1)).toEqual([
      [apiKeyIdOf(4)],
      [apiKeyIdOf(3)],
      [apiKeyIdOf(2)],
      [apiKeyIdOf(1)],
      [apiKeyIdOf(5)],
    ]);
  });

  test('各項目に名前・権限スコープ・発行日時を持たせる', async () => {
    await insertApiKey(1, OWNER, {
      name: '一覧のキー',
      scopeProducts: 'read',
      scopeLaunches: 'none',
      scopeUpvotes: 'read',
      scopeComments: 'none',
      scopeRatings: 'read',
      scopeProfile: 'read_write',
      scopeProductDescriptions: 'read',
      createdAt: after(700),
    });

    await expect(
      createStore().listByUser(userIdOf(OWNER), {
        limit: 10,
        before: undefined,
      }),
    ).resolves.toEqual([
      {
        id: apiKeyIdOf(1),
        userId: userIdOf(OWNER),
        name: '一覧のキー',
        scopes: ISSUED_SCOPES,
        createdAt: after(700),
      },
    ]);
  });

  test('キーを持たない利用者には空の一覧を返す', async () => {
    await insertApiKey(1, OTHER);

    await expect(
      createStore().listByUser(userIdOf(OWNER), {
        limit: 10,
        before: undefined,
      }),
    ).resolves.toEqual([]);
  });

  test('上限を超える数のキーも続きのカーソルで全て読める', async () => {
    const store = createStore();
    for (let index = 1; index <= UNLIMITED_KEY_COUNT; index += 1) {
      await store.insert(newKeyOf(index, OWNER));
    }

    const pages = await readAllPages(store, OWNER, 50);

    expect(pages.map((page) => page.length)).toEqual([50, 10]);
    expect(new Set(pages.flat()).size).toBe(UNLIMITED_KEY_COUNT);
  });
});

describe('D1ApiKeyStore: 利用者の物理削除', () => {
  test('保存を拒否した退会済みの利用者はキーの行を持たず、外部キーに妨げられず物理削除できる', async () => {
    await createStore().insert(newKeyOf(1, WITHDRAWN));

    await db.delete(users).where(eq(users.id, userIdOf(WITHDRAWN)));

    const [row] = await db
      .select({ rows: count() })
      .from(users)
      .where(eq(users.id, userIdOf(WITHDRAWN)));
    expect(row?.rows).toBe(0);
  });

  test('キーの行が残る利用者の物理削除は外部キーで失敗し、検知できる', async () => {
    await createStore().insert(newKeyOf(1, OWNER));

    const caught = await db
      .delete(users)
      .where(eq(users.id, userIdOf(OWNER)))
      .catch((error: unknown) => error);

    expect(causeMessagesOf(caught)).toContain('FOREIGN KEY constraint failed');
  });

  test('キーを全て削除した利用者は物理削除できる', async () => {
    const store = createStore();
    await store.insert(newKeyOf(1, OWNER));
    await store.delete(userIdOf(OWNER), apiKeyIdOf(1));

    await db.delete(users).where(eq(users.id, userIdOf(OWNER)));

    expect(await countKeysOf(OWNER)).toBe(0);
  });
});
