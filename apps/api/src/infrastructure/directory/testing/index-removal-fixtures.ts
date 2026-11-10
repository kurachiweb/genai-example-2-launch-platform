import { createUlidGenerator } from '../../../../lib/core/ids/id-generator.ts';
import { D1DirectoryEntryStore } from '../../../../lib/workers/directory/d1-directory-entry-store.ts';
import { insertIndexDocuments } from '../../../../lib/workers/directory/testing/directory-entry-fixtures.ts';
import {
  clearDirectoryTables,
  insertQualifiers,
  qualifierDecidedAt,
  winOf,
} from '../../../../lib/workers/directory/testing/directory-listing-fixtures.ts';
import {
  db,
  insertProducts,
  insertUsers,
  productIdOf,
  T0,
  userIdOf,
} from '../../../../lib/workers/product/testing/product-fixtures.ts';

export const OWNER = 1;
export const OTHER_OWNER = 2;

export const OWNER_FIRST_LISTED = 1;
export const OWNER_SECOND_LISTED = 5;
export const OTHER_OWNER_LISTED = 3;

const WIN_DATE = '2026-11-20';

// 予選の結果が全て確定した後の時刻にし、プロダクトの削除が予選の固定で拒否されないようにする
export const AFTER_DECISION = new Date(
  qualifierDecidedAt(WIN_DATE).getTime() + 60_000,
);

// 投稿者は勝利して掲載中のプロダクトを2件、他の投稿者は1件持ち、掲載中のプロダクトだけが記録と索引文書を持つ
export async function seedIndexRemovalScenario(): Promise<void> {
  await clearDirectoryTables();
  await insertUsers([OWNER, OTHER_OWNER]);
  await insertProducts([OWNER_FIRST_LISTED, 2, OWNER_SECOND_LISTED, 6], OWNER);
  await insertProducts([OTHER_OWNER_LISTED, 4], OTHER_OWNER);
  await insertQualifiers([
    winOf(1, {
      product: OWNER_FIRST_LISTED,
      owner: OWNER,
      date: WIN_DATE,
      opponent: 2,
    }),
    winOf(2, {
      product: OTHER_OWNER_LISTED,
      owner: OTHER_OWNER,
      date: WIN_DATE,
      opponent: 4,
    }),
    winOf(3, {
      product: OWNER_SECOND_LISTED,
      owner: OWNER,
      date: WIN_DATE,
      opponent: 6,
    }),
  ]);
  await new D1DirectoryEntryStore(
    db,
    createUlidGenerator({ now: () => T0 }),
  ).record(
    [
      { product: OWNER_FIRST_LISTED, owner: OWNER },
      { product: OWNER_SECOND_LISTED, owner: OWNER },
      { product: OTHER_OWNER_LISTED, owner: OTHER_OWNER },
    ].map(({ product, owner }) => ({
      productId: productIdOf(product),
      ownerUserId: userIdOf(owner),
    })),
    qualifierDecidedAt(WIN_DATE),
  );
  await insertIndexDocuments(
    [OWNER_FIRST_LISTED, OWNER_SECOND_LISTED, OTHER_OWNER_LISTED].map(
      productIdOf,
    ),
  );
}

export function indexedProductIdsOf(
  productIndexes: readonly number[],
): string[] {
  return productIndexes.map(productIdOf).toSorted();
}
