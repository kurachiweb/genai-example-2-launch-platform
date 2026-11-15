import { env } from 'cloudflare:workers';
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

import { createDatabase } from '../../../db/client.ts';
import type { SearchSource } from '../../core/search/search-target.ts';
import { RegistrySearchSourceProvider } from './search-source-provider.ts';
import {
  createSearchTargetRegistry,
  defineSearchTarget,
  SearchTargetRegistryError,
} from './search-target-definition.ts';
import {
  FIXTURE_SEARCH_TARGET_NAME,
  fixtureProducts,
  fixtureProductSearchDocuments,
  fixtureSearchTarget,
  setUpFixtureSearchTarget,
} from './testing/fixture-search-target.ts';

const TARGET = FIXTURE_SEARCH_TARGET_NAME;
const SOURCE_ID = '01JBD8G7Q3Z6W0K8N5S2X4Y9TA';
const UPDATED_AT = new Date('2026-10-31T03:04:05.678Z');

const db = createDatabase(env.DB);

beforeAll(async () => {
  await setUpFixtureSearchTarget(env.DB);
});

beforeEach(async () => {
  await db.delete(fixtureProductSearchDocuments);
  await db.delete(fixtureProducts);
});

describe('RegistrySearchSourceProvider', () => {
  test('検索対象の定義の読み取りへ、データベースと元データの識別子を渡してその結果を返す', async () => {
    const source: SearchSource = {
      version: 7,
      fields: { name: 'n', tagline: 't', description: 'd' },
    };
    const read = vi.fn(() => Promise.resolve(source));
    const registry = createSearchTargetRegistry([
      defineSearchTarget({ ...fixtureSearchTarget, read }),
    ]);

    const result = await new RegistrySearchSourceProvider(db, registry).read(
      TARGET,
      SOURCE_ID,
    );

    expect(result).toBe(source);
    expect(read).toHaveBeenCalledExactlyOnceWith(db, SOURCE_ID);
  });

  test('D1の元データを定義の読み取りで読み、索引の対象外ならundefinedを返す', async () => {
    const provider = new RegistrySearchSourceProvider(
      db,
      createSearchTargetRegistry([fixtureSearchTarget]),
    );
    await db.insert(fixtureProducts).values({
      id: SOURCE_ID,
      name: 'Launch Stadium',
      tagline: 'ship it today',
      description: '**rocket**',
      visible: true,
      updatedAt: UPDATED_AT,
      deletedAt: null,
    });

    await expect(provider.read(TARGET, SOURCE_ID)).resolves.toEqual({
      version: UPDATED_AT.getTime(),
      fields: {
        name: 'Launch Stadium',
        tagline: 'ship it today',
        description: '**rocket**',
      },
    });

    await db.update(fixtureProducts).set({ visible: false });

    await expect(provider.read(TARGET, SOURCE_ID)).resolves.toBeUndefined();
  });

  test('登録されていない検索対象は呼び出し側の誤りとして例外にする', async () => {
    const provider = new RegistrySearchSourceProvider(
      db,
      createSearchTargetRegistry([fixtureSearchTarget]),
    );

    await expect(
      provider.read('unregistered-target', SOURCE_ID),
    ).rejects.toThrow(SearchTargetRegistryError);
  });
});
