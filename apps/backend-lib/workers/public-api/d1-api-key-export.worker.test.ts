import { beforeEach, describe, expect, test } from 'vitest';

import type {
  ApiKeyExport,
  ApiKeyExportRecord,
} from '../../core/public-api/ports.ts';
import {
  after,
  createFailingDatabase,
  db,
  insertUser,
  T0,
  userIdOf,
} from '../identity/testing/identity-store-fixtures.ts';
import { D1ApiKeyExport } from './d1-api-key-export.ts';
import {
  apiKeyIdOf,
  clearApiKeyTables,
  insertApiKey,
  keyHashOf,
} from './testing/api-key-fixtures.ts';

const EXPORTED_FIELDS = [
  'name',
  'scopes',
  'createdAt',
] as const satisfies readonly (keyof ApiKeyExportRecord)[];

const SCOPE_KEYS = [
  'products',
  'launches',
  'upvotes',
  'comments',
  'ratings',
  'profile',
  'productDescriptions',
] as const;

function createApiKeyExport(database = db): ApiKeyExport {
  return new D1ApiKeyExport(database);
}

beforeEach(async () => {
  await clearApiKeyTables();
});

describe('D1ApiKeyExport', () => {
  test('利用者のキーだけを発行の古い順に返す', async () => {
    await insertUser(1);
    await insertUser(2);
    await insertApiKey(1, 1, { name: '新しいキー', createdAt: after(3000) });
    await insertApiKey(2, 2, { name: '他人のキー', createdAt: after(1000) });
    await insertApiKey(3, 1, { name: '古いキー', createdAt: after(1000) });
    await insertApiKey(4, 1, { name: '中間のキー', createdAt: after(2000) });

    const records = await createApiKeyExport().listByUser(userIdOf(1));

    expect(records.map(({ name }) => name)).toEqual([
      '古いキー',
      '中間のキー',
      '新しいキー',
    ]);
  });

  test('発行日時が同じキーはIDの順に返す', async () => {
    await insertUser(1);
    await insertApiKey(2, 1, { name: '後のID', createdAt: after(1000) });
    await insertApiKey(1, 1, { name: '先のID', createdAt: after(1000) });

    const records = await createApiKeyExport().listByUser(userIdOf(1));

    expect(records.map(({ name }) => name)).toEqual(['先のID', '後のID']);
  });

  test('名前・camelCaseのキーの権限スコープ・発行日時を返す', async () => {
    await insertUser(1);
    await insertApiKey(1, 1, {
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

    const records = await createApiKeyExport().listByUser(userIdOf(1));

    expect(records).toEqual([
      {
        name: '連携用',
        scopes: {
          products: 'read',
          launches: 'none',
          upvotes: 'read',
          comments: 'none',
          ratings: 'read',
          profile: 'read_write',
          productDescriptions: 'read',
        },
        createdAt: after(500),
      },
    ]);
  });

  test('結果に平文・ハッシュ・キーのID・利用者のIDを含めない', async () => {
    await insertUser(1);
    await insertApiKey(1, 1);

    const [record] = await createApiKeyExport().listByUser(userIdOf(1));

    expect(Object.keys(record ?? {}).toSorted()).toEqual(
      [...EXPORTED_FIELDS].toSorted(),
    );
    expect(Object.keys(record?.scopes ?? {}).toSorted()).toEqual(
      [...SCOPE_KEYS].toSorted(),
    );
    const serialized = JSON.stringify(record);
    expect(serialized).not.toContain(keyHashOf(1));
    expect(serialized).not.toContain(apiKeyIdOf(1));
    expect(serialized).not.toContain(userIdOf(1));
    expect(serialized).not.toContain('lsk_');
  });

  test('キーを持たない利用者には空の一覧を返す', async () => {
    await insertUser(1);
    await insertUser(2);
    await insertApiKey(1, 2, { createdAt: T0 });

    await expect(createApiKeyExport().listByUser(userIdOf(1))).resolves.toEqual(
      [],
    );
  });

  test('D1への問い合わせに失敗したら例外にする', async () => {
    await insertUser(1);
    await insertApiKey(1, 1);

    await expect(
      createApiKeyExport(createFailingDatabase()).listByUser(userIdOf(1)),
    ).rejects.toThrow();
  });
});
