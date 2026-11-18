import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { users } from '../../../db/schema/identity/users.ts';
import { products } from '../../../db/schema/product/products.ts';
import type { SponsorshipTier } from '../../../common-lib/sponsorship/sponsorship-tiers.ts';
import type { PlacedAd } from '../../core/sponsorship/ports.ts';
import { D1ProductDirectory } from '../product/d1-product-directory.ts';
import { insertProducts } from '../product/testing/product-fixtures.ts';
import { D1PlacementReader } from './d1-placement-reader.ts';
import {
  clearSponsorshipTables,
  db,
  insertSponsorships,
  insertSponsorUser,
  NOW,
  paidColumnsOf,
  productIdOf,
  sponsorshipIdOf,
  type SponsorshipFixture,
  T0,
  terminatedColumnsOf,
  userIdOf,
} from './testing/sponsorship-fixtures.ts';

const directory = new D1ProductDirectory(db);
const reader = new D1PlacementReader(db, directory);

// NOW(2026-11-25 0:00)の直前と翌日の0:00
const BEFORE_NOW = new Date(NOW.getTime() - 1);
const NEXT_DAY = new Date('2026-11-26T08:00:00.000Z');
const LAST_MOMENT_OF_TODAY = new Date(NEXT_DAY.getTime() - 1);

function paidFixture(
  index: number,
  product: number,
  tier: SponsorshipTier,
  period: { readonly startsOn: string; readonly endsOn: string },
  owner = 1,
): SponsorshipFixture {
  return {
    index,
    owner,
    product,
    columns: paidColumnsOf(index, { tier, ...period, days: 1 }),
  };
}

const COVERING_TODAY = { startsOn: '2026-11-20', endsOn: '2026-11-30' };

function idsByTier(
  placements: Readonly<Record<SponsorshipTier, readonly PlacedAd[]>>,
): Record<SponsorshipTier, string[]> {
  return {
    legend: placements.legend.map(({ sponsorshipId }) => sponsorshipId).sort(),
    gold: placements.gold.map(({ sponsorshipId }) => sponsorshipId).sort(),
    silver: placements.silver.map(({ sponsorshipId }) => sponsorshipId).sort(),
  };
}

function idsOf(...indexes: number[]): string[] {
  return indexes.map(sponsorshipIdOf).sort();
}

beforeEach(async () => {
  await clearSponsorshipTables();
  vi.restoreAllMocks();
});

describe('D1PlacementReader.read(広告が無い)', () => {
  test('全てのティアを空で返し、プロダクトの要約を読まない', async () => {
    const findSummaries = vi.spyOn(directory, 'findSummaries');

    const placements = await reader.read(NOW);

    expect(placements).toStrictEqual({ legend: [], gold: [], silver: [] });
    expect(findSummaries).not.toHaveBeenCalled();
  });
});

describe('D1PlacementReader.read(掲載期間)', () => {
  beforeEach(async () => {
    await insertSponsorUser(1);
    await insertProducts([1, 2, 3], 1);
    await insertSponsorships([
      paidFixture(1, 1, 'gold', {
        startsOn: '2026-11-25',
        endsOn: '2026-11-25',
      }),
      paidFixture(2, 2, 'silver', {
        startsOn: '2026-11-20',
        endsOn: '2026-11-24',
      }),
      paidFixture(3, 3, 'legend', {
        startsOn: '2026-11-26',
        endsOn: '2026-11-30',
      }),
    ]);
  });

  test('開始日の基準時刻の0:00から表示し、前日の終わりまでは表示しない', async () => {
    expect(idsByTier(await reader.read(BEFORE_NOW)).gold).toEqual([]);
    expect(idsByTier(await reader.read(NOW)).gold).toEqual(idsOf(1));
  });

  test('終了日の終わりまで表示し、翌日の基準時刻の0:00で表示しない', async () => {
    expect(idsByTier(await reader.read(BEFORE_NOW)).silver).toEqual(idsOf(2));
    expect(idsByTier(await reader.read(NOW)).silver).toEqual([]);
    expect(idsByTier(await reader.read(LAST_MOMENT_OF_TODAY)).gold).toEqual(
      idsOf(1),
    );
    expect(idsByTier(await reader.read(NEXT_DAY)).gold).toEqual([]);
  });

  test('翌日開始の広告は翌日の基準時刻の0:00で表示する', async () => {
    expect(idsByTier(await reader.read(LAST_MOMENT_OF_TODAY)).legend).toEqual(
      [],
    );
    expect(idsByTier(await reader.read(NEXT_DAY)).legend).toEqual(idsOf(3));
  });
});

describe('D1PlacementReader.read(表示の条件)', () => {
  beforeEach(async () => {
    await insertSponsorUser(1);
    await insertSponsorUser(2, 'suspended');
    await insertSponsorUser(3, 'withdrawn');
    await insertProducts([1, 6, 7], 1);
    await insertProducts([2], 1, { hiddenAt: T0 });
    await insertProducts([3], 1, { deletedAt: T0 });
    await insertProducts([4], 2);
    await insertProducts([5], 3);
    await insertSponsorships([
      paidFixture(1, 1, 'gold', COVERING_TODAY),
      {
        index: 4,
        owner: 1,
        product: 6,
        columns: { tier: 'gold', ...COVERING_TODAY },
      },
      {
        index: 5,
        owner: 1,
        product: 6,
        columns: terminatedColumnsOf(5, { tier: 'silver', ...COVERING_TODAY }),
      },
      {
        index: 6,
        owner: 1,
        product: 7,
        columns: paidColumnsOf(6, {
          tier: 'silver',
          ...COVERING_TODAY,
          deletedAt: T0,
        }),
      },
      paidFixture(7, 2, 'gold', COVERING_TODAY),
      {
        index: 8,
        owner: 1,
        product: 3,
        columns: paidColumnsOf(8, {
          tier: 'gold',
          ...COVERING_TODAY,
          productDeletedAt: T0,
        }),
      },
      paidFixture(9, 4, 'gold', COVERING_TODAY, 2),
      paidFixture(10, 5, 'gold', COVERING_TODAY, 3),
      paidFixture(11, 6, 'legend', COVERING_TODAY),
      paidFixture(12, 7, 'gold', COVERING_TODAY),
    ]);
  });

  test('未決済・強制終了・論理削除した申込と、非公開化・論理削除・投稿者の停止と退会のプロダクトの広告を除き、ティアごとに分けて返す', async () => {
    const placements = await reader.read(NOW);

    expect(idsByTier(placements)).toEqual({
      legend: idsOf(11),
      gold: idsOf(1, 12),
      silver: [],
    });
  });

  test('各広告はティアと可視のプロダクトの要約を持つ', async () => {
    const placements = await reader.read(NOW);
    const summaries = await directory.findSummaries(
      [productIdOf(6)],
      'visible',
    );

    expect(placements.legend).toStrictEqual([
      {
        sponsorshipId: sponsorshipIdOf(11),
        tier: 'legend',
        product: summaries.get(productIdOf(6)),
      },
    ]);
  });

  test('非公開化の取り消しと停止の解除の後は、次の照会から再び表示する', async () => {
    await db
      .update(products)
      .set({ hiddenAt: null })
      .where(eq(products.id, productIdOf(2)));
    await db
      .update(users)
      .set({ status: 'active', suspendedAt: null })
      .where(eq(users.id, userIdOf(2)));

    const placements = await reader.read(NOW);

    expect(idsByTier(placements).gold).toEqual(idsOf(1, 7, 9, 12));
  });

  test('照会の後で表示の情報を読むまでに可視でなくなった広告を除く', async () => {
    const findSummaries = directory.findSummaries.bind(directory);
    vi.spyOn(directory, 'findSummaries').mockImplementation(
      async (ids, scope) => {
        await db
          .update(products)
          .set({ hiddenAt: T0 })
          .where(eq(products.id, productIdOf(7)));
        return findSummaries(ids, scope);
      },
    );

    const placements = await reader.read(NOW);

    expect(idsByTier(placements).gold).toEqual(idsOf(1));
  });

  test('申込の照会1回とプロダクトの要約の照会1回で読む', async () => {
    const select = vi.spyOn(db, 'select');
    const delegate = directory.findSummaries.bind(directory);
    let selectsInDirectory = 0;
    const findSummaries = vi
      .spyOn(directory, 'findSummaries')
      .mockImplementation(async (ids, scope) => {
        const before = select.mock.calls.length;
        const found = await delegate(ids, scope);
        selectsInDirectory += select.mock.calls.length - before;
        return found;
      });

    await reader.read(NOW);

    expect(select.mock.calls.length - selectsInDirectory).toBe(1);
    expect(findSummaries).toHaveBeenCalledTimes(1);
    expect(findSummaries.mock.calls[0]?.[1]).toBe('visible');
    expect([...(findSummaries.mock.calls[0]?.[0] ?? [])].sort()).toEqual(
      [1, 6, 7].map(productIdOf).sort(),
    );
  });

  test('表示とクリックを記録せず、どのテーブルにも書き込まない', async () => {
    const writes = [
      vi.spyOn(db, 'insert'),
      vi.spyOn(db, 'update'),
      vi.spyOn(db, 'delete'),
      vi.spyOn(db, 'batch'),
      vi.spyOn(db, 'run'),
    ];

    await reader.read(NOW);

    for (const write of writes) {
      expect(write).not.toHaveBeenCalled();
    }
  });
});

describe('D1PlacementReader.read(件数と並び)', () => {
  const MANY = 120;

  beforeEach(async () => {
    await insertSponsorUser(1);
    const indexes = Array.from({ length: MANY }, (_, offset) => offset + 1);
    await insertProducts(indexes, 1);
    await insertSponsorships(
      indexes.map((index) => paidFixture(index, index, 'gold', COVERING_TODAY)),
    );
  });

  test('表示の条件を満たす全ての広告を件数の上限なく返す', async () => {
    const placements = await reader.read(NOW);

    expect(placements.gold).toHaveLength(MANY);
    expect(idsByTier(placements).gold).toEqual(
      idsOf(...Array.from({ length: MANY }, (_, offset) => offset + 1)),
    );
  });

  test('照会のたびにティアの中の並びが乱数で変わる', async () => {
    const orders = new Set<string>();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const placements = await reader.read(NOW);
      orders.add(
        placements.gold.map(({ sponsorshipId }) => sponsorshipId).join(),
      );
    }

    expect(orders.size).toBeGreaterThan(1);
  });
});
