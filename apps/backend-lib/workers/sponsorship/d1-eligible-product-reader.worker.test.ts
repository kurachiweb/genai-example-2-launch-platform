import { beforeEach, describe, expect, test } from 'vitest';

import { D1ProductDirectory } from '../product/d1-product-directory.ts';
import { D1LaunchExport } from '../product/d1-product-export.ts';
import { logoFileIdOf } from '../product/testing/product-fixtures.ts';
import { D1EligibleProductReader } from './d1-eligible-product-reader.ts';
import {
  clearSponsorshipTables,
  db,
  insertSponsorProduct,
  insertSponsorUser,
  NOW,
  productIdOf,
  type SponsorProductFixture,
  userIdOf,
} from './testing/sponsorship-fixtures.ts';

const reader = new D1EligibleProductReader(
  new D1LaunchExport(db),
  new D1ProductDirectory(db),
);

const OWNER = userIdOf(1);

// キックオフ前のローンチのローンチ日2026-11-28の基準時刻(UTC-08:00)の0:00の前後
const BEFORE_KICKOFF = new Date('2026-11-28T07:59:59.999Z');
const AT_KICKOFF = new Date('2026-11-28T08:00:00.000Z');

const PRODUCTS: readonly SponsorProductFixture[] = [
  { index: 1, owner: 1, launches: ['before_kickoff'] },
  { index: 2, owner: 1, launches: ['canceled'] },
  { index: 3, owner: 1, launches: ['canceled', 'before_kickoff'] },
  { index: 4, owner: 1, launches: ['in_progress'] },
  { index: 5, owner: 1, launches: ['finished'] },
  { index: 6, owner: 1, launches: ['finished', 'canceled', 'before_kickoff'] },
  { index: 7, owner: 1, state: 'hidden', launches: ['finished'] },
  { index: 8, owner: 1, state: 'deleted', launches: ['in_progress'] },
  { index: 9, owner: 2, launches: ['finished'] },
  { index: 10, owner: 1, launches: [] },
  { index: 11, owner: 1, launches: ['finished', 'in_progress'] },
  { index: 12, owner: 3, launches: ['finished'] },
];

function eligibleOf(index: number) {
  return {
    productId: productIdOf(index),
    handle: `product${String(index)}`,
    name: `プロダクト${String(index)}`,
    logoFileId: logoFileIdOf(index),
  };
}

beforeEach(async () => {
  await clearSponsorshipTables();
  await insertSponsorUser(1);
  await insertSponsorUser(2);
  await insertSponsorUser(3, 'suspended');
  for (const product of PRODUCTS) {
    await insertSponsorProduct(product);
  }
});

describe('D1EligibleProductReader.list', () => {
  test('キックオフを迎えた取り消されていないローンチを持つ自分の可視のプロダクトだけを名称の順に1件ずつ返す', async () => {
    const products = await reader.list(OWNER, NOW);

    expect(products).toStrictEqual([11, 4, 5, 6].map(eligibleOf));
  });

  test('他人の申込の対象は他人の一覧にだけ現れる', async () => {
    const products = await reader.list(userIdOf(2), NOW);

    expect(products).toStrictEqual([eligibleOf(9)]);
  });

  test('停止中の投稿者のプロダクトは可視でないため返さない', async () => {
    const products = await reader.list(userIdOf(3), NOW);

    expect(products).toStrictEqual([]);
  });

  test('キックオフ前のローンチは基準時刻のローンチ日の0:00を迎えると対象になる', async () => {
    const before = await reader.list(OWNER, BEFORE_KICKOFF);
    const after = await reader.list(OWNER, AT_KICKOFF);

    expect(before).not.toContainEqual(eligibleOf(1));
    expect(after).toContainEqual(eligibleOf(1));
  });
});

describe('D1EligibleProductReader.isEligible', () => {
  test.each([
    [4, true],
    [5, true],
    [6, true],
    [11, true],
    [1, false],
    [2, false],
    [3, false],
    [7, false],
    [8, false],
    [9, false],
    [10, false],
    [12, false],
  ])('プロダクト%iの判定は%sになる', async (index, expected) => {
    const eligible = await reader.isEligible(OWNER, productIdOf(index), NOW);

    expect(eligible).toBe(expected);
  });

  test('存在しないプロダクトは対象でない', async () => {
    const eligible = await reader.isEligible(OWNER, productIdOf(99), NOW);

    expect(eligible).toBe(false);
  });

  test.each([
    [1, NOW],
    [2, NOW],
    [3, NOW],
    [1, AT_KICKOFF],
  ])('利用者%iについて1件の判定が一覧と同じ結果になる', async (user, now) => {
    const listed = new Set(
      (await reader.list(userIdOf(user), now)).map(
        ({ productId }) => productId,
      ),
    );

    for (const { index } of PRODUCTS) {
      const productId = productIdOf(index);
      const eligible = await reader.isEligible(userIdOf(user), productId, now);

      expect(eligible, productId).toBe(listed.has(productId));
    }
  });
});
