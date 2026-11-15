import { beforeEach, describe, expect, test } from 'vitest';

import type { DirectoryEntryStore } from '../../core/directory/ports.ts';
import { createUlidGenerator } from '../../core/ids/id-generator.ts';
import {
  after,
  db,
  insertProducts,
  insertUsers,
  productIdOf,
  T0,
  userIdOf,
} from '../product/testing/product-fixtures.ts';
import { D1DirectoryEntryStore } from './d1-directory-entry-store.ts';
import { accountIndexRemovalStatement } from './product-index-removal-statements.ts';
import {
  insertIndexDocuments,
  readDirectoryEntries,
  readIndexedProductIds,
} from './testing/directory-entry-fixtures.ts';
import { clearDirectoryTables } from './testing/directory-listing-fixtures.ts';

const OWNER = 1;
const OTHER_OWNER = 2;

const OWNED = [1, 2];
const OWNED_LATER = 3;
const OTHERS = 4;
const OWNED_WITHOUT_ENTRY = 5;

const store: DirectoryEntryStore = new D1DirectoryEntryStore(
  db,
  createUlidGenerator({ now: () => T0 }),
);

function entryOf(product: number, owner: number) {
  return { productId: productIdOf(product), ownerUserId: userIdOf(owner) };
}

beforeEach(async () => {
  await clearDirectoryTables();
  await insertUsers([OWNER, OTHER_OWNER]);
  await insertProducts([...OWNED, OWNED_LATER, OWNED_WITHOUT_ENTRY], OWNER);
  await insertProducts([OTHERS], OTHER_OWNER);
  await store.record(
    [
      ...OWNED.map((product) => entryOf(product, OWNER)),
      entryOf(OTHERS, OTHER_OWNER),
    ],
    after(1),
  );
  await insertIndexDocuments(
    [...OWNED, OTHERS, OWNED_WITHOUT_ENTRY].map(productIdOf),
  );
});

describe('accountIndexRemovalStatement', () => {
  test('投稿者の勝利したプロダクトの索引文書だけを消し、記録と他の投稿者の索引文書は残す', async () => {
    await db.batch([accountIndexRemovalStatement(db, userIdOf(OWNER))]);

    expect(await readIndexedProductIds()).toEqual(
      [OTHERS, OWNED_WITHOUT_ENTRY].map(productIdOf),
    );
    expect(await readDirectoryEntries()).toHaveLength(OWNED.length + 1);
  });

  test('文を組み立てた後に増えた記録にも、確定の時点の全ての行に効く', async () => {
    const statement = accountIndexRemovalStatement(db, userIdOf(OWNER));
    await store.record([entryOf(OWNED_LATER, OWNER)], after(2));
    await insertIndexDocuments([productIdOf(OWNED_LATER)]);

    await db.batch([statement]);

    expect(await readIndexedProductIds()).toEqual(
      [OTHERS, OWNED_WITHOUT_ENTRY].map(productIdOf),
    );
  });

  test('記録の無い投稿者では何も消さない', async () => {
    await db.batch([accountIndexRemovalStatement(db, userIdOf(99))]);

    expect(await readIndexedProductIds()).toEqual(
      [...OWNED, OTHERS, OWNED_WITHOUT_ENTRY].map(productIdOf),
    );
  });
});
