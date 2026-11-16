import { env } from 'cloudflare:workers';
import { and, asc, avg, count, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';

import { createDatabase } from '../../client.ts';
import { users } from '../identity/users.ts';
import { productLaunches } from '../product/product-launches.ts';
import { products } from '../product/products.ts';
import { displayableComment, validRating } from './engagement-conditions.ts';
import { launchComments } from './launch-comments.ts';
import { productRatings } from './product-ratings.ts';

const OTHER_CATEGORY_ID = '01JD0000000000000000000000';

const PRODUCT_ID = '01JD0000000000000000000P01';

const LAUNCH_ID = '01JD0000000000000000000L01';

const AT = new Date(Date.UTC(2026, 10, 15));

type UserKind = 'active' | 'suspended' | 'withdrawn' | 'owner';

const USER_IDS: Readonly<Record<UserKind, string>> = {
  owner: '01JD0000000000000000000U00',
  active: '01JD0000000000000000000U01',
  suspended: '01JD0000000000000000000U02',
  withdrawn: '01JD0000000000000000000U03',
};

const db = createDatabase(env.DB);

async function insertBaseFixtures(): Promise<void> {
  await db.insert(users).values(
    (Object.keys(USER_IDS) as UserKind[]).map((kind) => ({
      id: USER_IDS[kind],
      pseudonymousId: `pseudonymous-${kind}`,
      email: `${kind}@engagement.example`,
      passwordHash: 'hash',
      nickname: kind,
      handle: kind,
      status:
        kind === 'suspended' ? ('suspended' as const) : ('active' as const),
      emailVerifiedAt: AT,
      termsAgreedAt: AT,
      deletedAt: kind === 'withdrawn' ? AT : null,
    })),
  );
  await db.insert(products).values({
    id: PRODUCT_ID,
    userId: USER_IDS.owner,
    categoryId: OTHER_CATEGORY_ID,
    handle: 'engagement-product',
    name: 'engagement-product',
    tagline: 'タグライン',
    websiteUrl: 'https://engagement.example/',
    descriptionMarkdown: '説明文',
    logoFileId: 'logo-engagement-product',
    latestLaunchDate: '2026-11-15',
  });
  await db.insert(productLaunches).values({
    id: LAUNCH_ID,
    productId: PRODUCT_ID,
    launchDate: '2026-11-15',
  });
}

interface CommentFixture {
  readonly id: string;
  readonly author: UserKind | null;
  readonly deletedAt?: Date;
  readonly hiddenAt?: Date;
  readonly anonymizedAt?: Date;
}

const COMMENT_FIXTURES: readonly CommentFixture[] = [
  { id: 'c01-shown', author: 'active' },
  { id: 'c02-deleted', author: 'active', deletedAt: AT },
  { id: 'c03-hidden', author: 'active', hiddenAt: AT },
  { id: 'c04-anonymized', author: null, deletedAt: AT, anonymizedAt: AT },
  { id: 'c05-author-suspended', author: 'suspended' },
  { id: 'c06-author-withdrawn', author: 'withdrawn' },
  { id: 'c07-author-unlinked', author: null },
];

const commentRowOf = (fixture: CommentFixture) => ({
  id: fixture.id,
  productId: PRODUCT_ID,
  launchId: LAUNCH_ID,
  rootId: fixture.id,
  depth: 1,
  authorUserId: fixture.author === null ? null : USER_IDS[fixture.author],
  body: fixture.anonymizedAt === undefined ? '本文' : '',
  deletedAt: fixture.deletedAt ?? null,
  hiddenAt: fixture.hiddenAt ?? null,
  anonymizedAt: fixture.anonymizedAt ?? null,
});

interface RatingFixture {
  readonly id: string;
  readonly rater: UserKind;
  readonly score: number;
  readonly invalidatedAt?: Date;
  readonly deletedAt?: Date;
}

const RATING_FIXTURES: readonly RatingFixture[] = [
  { id: 'r01-valid', rater: 'active', score: 4 },
  { id: 'r02-suspended', rater: 'suspended', score: 1 },
  { id: 'r03-withdrawn', rater: 'withdrawn', score: 1, deletedAt: AT },
  { id: 'r04-invalidated', rater: 'owner', score: 1, invalidatedAt: AT },
];

const ratingRowOf = (fixture: RatingFixture) => ({
  id: fixture.id,
  productId: PRODUCT_ID,
  userId: USER_IDS[fixture.rater],
  score: fixture.score,
  invalidatedAt: fixture.invalidatedAt ?? null,
  deletedAt: fixture.deletedAt ?? null,
});

async function commentStates(): Promise<
  readonly { readonly id: string; readonly displayable: number }[]
> {
  return db
    .select({
      id: launchComments.id,
      displayable: count(users.id).mapWith(Number),
    })
    .from(launchComments)
    .leftJoin(
      users,
      and(eq(users.id, launchComments.authorUserId), displayableComment()),
    )
    .groupBy(launchComments.id)
    .orderBy(asc(launchComments.id));
}

async function displayableCommentIds(): Promise<string[]> {
  const rows = await db
    .select({ id: launchComments.id })
    .from(launchComments)
    .leftJoin(users, eq(users.id, launchComments.authorUserId))
    .where(displayableComment())
    .orderBy(asc(launchComments.id));
  return rows.map((row) => row.id);
}

async function validRatingIds(): Promise<string[]> {
  const rows = await db
    .select({ id: productRatings.id })
    .from(productRatings)
    .innerJoin(users, eq(users.id, productRatings.userId))
    .where(validRating())
    .orderBy(asc(productRatings.id));
  return rows.map((row) => row.id);
}

beforeEach(async () => {
  await db.delete(productRatings);
  await db.delete(launchComments);
  await db.delete(productLaunches);
  await db.delete(products);
  await db.delete(users);
  await insertBaseFixtures();
});

describe('displayableComment', () => {
  beforeEach(async () => {
    await db.insert(launchComments).values(COMMENT_FIXTURES.map(commentRowOf));
  });

  test('削除・非公開化・匿名化の印があるコメントと、投稿者が外れた・停止中・退会済みのコメントを除く', async () => {
    expect(await displayableCommentIds()).toEqual(['c01-shown']);
  });

  test('外部結合の条件に使うと、置き換え表示の行も落とさずに表示できるかどうかを行ごとに判定できる', async () => {
    expect(await commentStates()).toEqual([
      { id: 'c01-shown', displayable: 1 },
      { id: 'c02-deleted', displayable: 0 },
      { id: 'c03-hidden', displayable: 0 },
      { id: 'c04-anonymized', displayable: 0 },
      { id: 'c05-author-suspended', displayable: 0 },
      { id: 'c06-author-withdrawn', displayable: 0 },
      { id: 'c07-author-unlinked', displayable: 0 },
    ]);
  });

  test('投稿者の停止の解除と非公開化の取消で、表示できるコメントに戻る', async () => {
    await db
      .update(users)
      .set({ status: 'active' })
      .where(eq(users.id, USER_IDS.suspended));
    await db
      .update(launchComments)
      .set({ hiddenAt: null })
      .where(eq(launchComments.id, 'c03-hidden'));

    expect(await displayableCommentIds()).toEqual([
      'c01-shown',
      'c03-hidden',
      'c05-author-suspended',
    ]);
  });
});

describe('validRating', () => {
  beforeEach(async () => {
    await db.insert(productRatings).values(RATING_FIXTURES.map(ratingRowOf));
  });

  test('無効化・論理削除した評価と、停止中・退会済みの評価者の評価を除く', async () => {
    expect(await validRatingIds()).toEqual(['r01-valid']);
  });

  test('有効な評価だけから平均値と件数を求められ、停止の解除で戻る', async () => {
    const summarize = () =>
      db
        .select({
          average: avg(productRatings.score).mapWith(Number),
          ratings: count(),
        })
        .from(productRatings)
        .innerJoin(users, eq(users.id, productRatings.userId))
        .where(and(eq(productRatings.productId, PRODUCT_ID), validRating()));

    expect(await summarize()).toEqual([{ average: 4, ratings: 1 }]);

    await db
      .update(users)
      .set({ status: 'active' })
      .where(eq(users.id, USER_IDS.suspended));

    expect(await summarize()).toEqual([{ average: 2.5, ratings: 2 }]);
  });
});

describe('テーブルの制約', () => {
  test.each([0, 4])(
    '階層が%iのコメントはCHECK制約で拒まれる',
    async (depth) => {
      await expect(
        db.insert(launchComments).values({
          ...commentRowOf({ id: 'c99-out-of-range', author: 'active' }),
          depth,
        }),
      ).rejects.toThrow();
    },
  );

  test.each([0, 6])(
    '評価の値が%iの評価はCHECK制約で拒まれる',
    async (score) => {
      await expect(
        db
          .insert(productRatings)
          .values(ratingRowOf({ id: 'r99', rater: 'active', score })),
      ).rejects.toThrow();
    },
  );

  test('同じ利用者から同じプロダクトへの2件目の評価は一意索引で拒まれる', async () => {
    await db
      .insert(productRatings)
      .values(ratingRowOf({ id: 'r01-first', rater: 'active', score: 3 }));

    await expect(
      db
        .insert(productRatings)
        .values(ratingRowOf({ id: 'r02-second', rater: 'active', score: 5 })),
    ).rejects.toThrow();
  });

  test('第3階層までの返信は、親とルートを参照して追加できる', async () => {
    await db.insert(launchComments).values([
      commentRowOf({ id: 'c10-root', author: 'active' }),
      {
        ...commentRowOf({ id: 'c11-reply', author: 'active' }),
        parentId: 'c10-root',
        rootId: 'c10-root',
        depth: 2,
      },
      {
        ...commentRowOf({ id: 'c12-reply', author: 'active' }),
        parentId: 'c11-reply',
        rootId: 'c10-root',
        depth: 3,
      },
    ]);

    expect(await displayableCommentIds()).toEqual([
      'c10-root',
      'c11-reply',
      'c12-reply',
    ]);
  });
});
