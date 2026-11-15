import { env } from 'cloudflare:workers';
import { and, asc, count, eq, ne, type SQL } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';

import { createDatabase } from '../../client.ts';
import { users } from '../identity/users.ts';
import { productCategories } from './product-categories.ts';
import { productLaunches } from './product-launches.ts';
import { products } from './products.ts';
import {
  productInCategory,
  visibleProducts,
  wonLaunchExists,
} from './visibility.ts';

const OTHER_CATEGORY_ID = '01JD0000000000000000000000';

const TOOLS_CATEGORY_ID = '01JD0000000000000000000C01';

const AT = new Date(Date.UTC(2026, 10, 9));

type UserKind = 'active' | 'suspended' | 'withdrawn';

type LaunchKind = 'won' | 'lost' | 'won-cancelled' | 'open';

interface ProductFixture {
  readonly id: string;
  readonly owner: UserKind;
  readonly categoryId: string;
  readonly hidden?: boolean;
  readonly deleted?: boolean;
  readonly launches: readonly LaunchKind[];
}

const USER_IDS: Readonly<Record<UserKind, string>> = {
  active: '01JD0000000000000000000U01',
  suspended: '01JD0000000000000000000U02',
  withdrawn: '01JD0000000000000000000U03',
};

const PRODUCT_FIXTURES: readonly ProductFixture[] = [
  {
    id: 'p01-tools-won',
    owner: 'active',
    categoryId: TOOLS_CATEGORY_ID,
    launches: ['lost', 'won'],
  },
  {
    id: 'p02-tools-lost',
    owner: 'active',
    categoryId: TOOLS_CATEGORY_ID,
    launches: ['lost', 'open'],
  },
  {
    id: 'p03-tools-hidden',
    owner: 'active',
    categoryId: TOOLS_CATEGORY_ID,
    hidden: true,
    launches: ['won'],
  },
  {
    id: 'p04-other-deleted',
    owner: 'active',
    categoryId: OTHER_CATEGORY_ID,
    deleted: true,
    launches: ['won'],
  },
  {
    id: 'p05-tools-suspended',
    owner: 'suspended',
    categoryId: TOOLS_CATEGORY_ID,
    launches: ['won'],
  },
  {
    id: 'p06-other-withdrawn',
    owner: 'withdrawn',
    categoryId: OTHER_CATEGORY_ID,
    deleted: true,
    launches: ['won'],
  },
  {
    id: 'p07-other-cancelled',
    owner: 'active',
    categoryId: OTHER_CATEGORY_ID,
    launches: ['won-cancelled', 'open'],
  },
  {
    id: 'p08-other-won',
    owner: 'active',
    categoryId: OTHER_CATEGORY_ID,
    launches: ['won'],
  },
];

const db = createDatabase(env.DB);

function launchRowOf(productId: string, kind: LaunchKind, index: number) {
  const launchDate = `2026-10-${String(10 + index).padStart(2, '0')}`;
  switch (kind) {
    case 'won':
    case 'lost':
      return { productId, launchDate, outcome: kind, decidedAt: AT };
    case 'won-cancelled':
      return {
        productId,
        launchDate,
        outcome: 'won' as const,
        decidedAt: AT,
        cancelledAt: AT,
      };
    case 'open':
      return { productId, launchDate };
  }
}

async function insertFixtures(): Promise<void> {
  await db.insert(users).values(
    (Object.keys(USER_IDS) as UserKind[]).map((kind) => ({
      id: USER_IDS[kind],
      pseudonymousId: `pseudonymous-${kind}`,
      email: `${kind}@product.example`,
      passwordHash: 'hash',
      nickname: kind,
      handle: kind,
      status:
        kind === 'suspended' ? ('suspended' as const) : ('active' as const),
      termsAgreedAt: AT,
      deletedAt: kind === 'withdrawn' ? AT : null,
    })),
  );
  await db.insert(productCategories).values({
    id: TOOLS_CATEGORY_ID,
    name: 'Developer Tools',
    handle: 'tools',
  });
  // D1は1文のバインド変数を100個までに限るため、行ごとに追加する
  for (const fixture of PRODUCT_FIXTURES) {
    await db.insert(products).values({
      id: fixture.id,
      userId: USER_IDS[fixture.owner],
      categoryId: fixture.categoryId,
      handle: fixture.id,
      name: fixture.id,
      tagline: 'タグライン',
      websiteUrl: 'https://product.example/',
      descriptionMarkdown: '説明文',
      logoFileId: `logo-${fixture.id}`,
      latestLaunchDate: '2026-10-20',
      hiddenAt: fixture.hidden === true ? AT : null,
      deletedAt: fixture.deleted === true ? AT : null,
    });
    for (const [index, kind] of fixture.launches.entries()) {
      await db
        .insert(productLaunches)
        .values(launchRowOf(fixture.id, kind, index));
    }
  }
}

async function productIdsWhere(condition: SQL | undefined): Promise<string[]> {
  const rows = await db
    .select({ id: products.id })
    .from(products)
    .innerJoin(users, eq(products.userId, users.id))
    .where(condition)
    .orderBy(asc(products.id));
  return rows.map((row) => row.id);
}

beforeEach(async () => {
  await db.delete(productLaunches);
  await db.delete(products);
  await db
    .delete(productCategories)
    .where(ne(productCategories.id, OTHER_CATEGORY_ID));
  await db.delete(users);
  await insertFixtures();
});

describe('visibleProducts', () => {
  test('論理削除・非公開化したプロダクトと、停止中・退会済みの投稿者のプロダクトを除く', async () => {
    expect(await productIdsWhere(visibleProducts())).toEqual([
      'p01-tools-won',
      'p02-tools-lost',
      'p07-other-cancelled',
      'p08-other-won',
    ]);
  });
});

describe('wonLaunchExists', () => {
  test('可視の条件と組み合わせると、取消でない勝利のローンチを持つ可視のプロダクトだけが残る', async () => {
    expect(
      await productIdsWhere(and(visibleProducts(), wonLaunchExists())),
    ).toEqual(['p01-tools-won', 'p08-other-won']);
  });

  test('単独では可視かどうかを問わず、取消でない勝利のローンチの有無だけで絞り込む', async () => {
    expect(await productIdsWhere(wonLaunchExists())).toEqual([
      'p01-tools-won',
      'p03-tools-hidden',
      'p04-other-deleted',
      'p05-tools-suspended',
      'p06-other-withdrawn',
      'p08-other-won',
    ]);
  });
});

describe('productInCategory', () => {
  test('単独では可視かどうかを問わず、そのカテゴリのプロダクトに絞り込む', async () => {
    expect(await productIdsWhere(productInCategory(TOOLS_CATEGORY_ID))).toEqual(
      [
        'p01-tools-won',
        'p02-tools-lost',
        'p03-tools-hidden',
        'p05-tools-suspended',
      ],
    );
  });

  test('可視・勝利の条件と組み合わせると、そのカテゴリの掲載済みのプロダクトだけが残る', async () => {
    expect(
      await productIdsWhere(
        and(
          productInCategory(TOOLS_CATEGORY_ID),
          visibleProducts(),
          wonLaunchExists(),
        ),
      ),
    ).toEqual(['p01-tools-won']);
  });

  test('可視・勝利の条件で絞った行をカテゴリごとに数えられる', async () => {
    const rows = await db
      .select({ categoryId: products.categoryId, listed: count() })
      .from(products)
      .innerJoin(users, eq(products.userId, users.id))
      .where(and(visibleProducts(), wonLaunchExists()))
      .groupBy(products.categoryId)
      .orderBy(asc(products.categoryId));

    expect(rows).toEqual([
      { categoryId: OTHER_CATEGORY_ID, listed: 1 },
      { categoryId: TOOLS_CATEGORY_ID, listed: 1 },
    ]);
  });
});
