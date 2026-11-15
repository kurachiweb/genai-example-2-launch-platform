import { beforeEach, describe, expect, test } from 'vitest';

import type {
  AdminRatingDirectory,
  AdminRatingRecord,
} from '../../core/engagement/ports.ts';
import { AppError } from '../../core/errors/app-error.ts';
import { createFailingDatabase } from '../identity/testing/identity-store-fixtures.ts';
import { insertProducts } from '../product/testing/product-fixtures.ts';
import { D1AdminRatingDirectory } from './d1-admin-rating-directory.ts';
import {
  after,
  clearEngagementTables,
  db,
  insertProduct,
  insertRating,
  insertRatings,
  insertUser,
  productIdOf,
  type RatingFixture,
  ratingIdOf,
  T0,
  userIdOf,
} from './testing/engagement-fixtures.ts';

const OWNER = 1;
const RATER = 2;
const OTHER_RATER = 3;
const WITHDRAWN = 4;
const SUSPENDED = 5;
const PRODUCT = 1;
const OTHER_PRODUCT = 2;
const HIDDEN_PRODUCT = 3;

const BASE64URL_OPTIONS = {
  alphabet: 'base64url',
  omitPadding: true,
} as const;

const textEncoder = new TextEncoder();

function base64urlOf(text: string): string {
  return textEncoder.encode(text).toBase64(BASE64URL_OPTIONS);
}

function createDirectory(database = db): AdminRatingDirectory {
  return new D1AdminRatingDirectory(database);
}

function ratingAt(
  index: number,
  milliseconds: number,
  fixture: Partial<RatingFixture> = {},
): RatingFixture {
  return {
    index,
    product: PRODUCT,
    user: RATER,
    ...fixture,
    columns: { updatedAt: after(milliseconds), ...fixture.columns },
  };
}

function idsOf(ratings: readonly AdminRatingRecord[]): string[] {
  return ratings.map((rating) => rating.ratingId);
}

function range(start: number, end: number): number[] {
  return Array.from({ length: end - start + 1 }, (_, offset) => start + offset);
}

beforeEach(async () => {
  await clearEngagementTables();
  await insertUser(OWNER, { emailVerifiedAt: T0 });
  await insertUser(RATER, { emailVerifiedAt: T0 });
  await insertUser(OTHER_RATER, { emailVerifiedAt: T0 });
  await insertUser(WITHDRAWN, { emailVerifiedAt: T0, deletedAt: after(1) });
  await insertUser(SUSPENDED, { emailVerifiedAt: T0, status: 'suspended' });
  await insertProduct(PRODUCT, OWNER);
  await insertProduct(OTHER_PRODUCT, OWNER);
  await insertProduct(HIDDEN_PRODUCT, OWNER, { hiddenAt: after(1) });
});

describe('D1AdminRatingDirectory.search', () => {
  test('評価の識別・プロダクト・評価者・値・無効化の日時・作成と更新の日時を返す', async () => {
    await insertRating({
      index: 1,
      product: PRODUCT,
      user: RATER,
      score: 5,
      columns: { createdAt: after(1000), updatedAt: after(3000) },
    });
    await insertRating({
      index: 2,
      product: PRODUCT,
      user: OTHER_RATER,
      score: 1,
      columns: {
        createdAt: after(1500),
        updatedAt: after(2000),
        invalidatedAt: after(2500),
      },
    });

    const { ratings, nextCursor } = await createDirectory().search(
      {},
      { limit: 10 },
    );

    expect(ratings).toEqual([
      {
        ratingId: ratingIdOf(1),
        productId: productIdOf(PRODUCT),
        userId: userIdOf(RATER),
        score: 5,
        invalidatedAt: null,
        createdAt: after(1000),
        updatedAt: after(3000),
      },
      {
        ratingId: ratingIdOf(2),
        productId: productIdOf(PRODUCT),
        userId: userIdOf(OTHER_RATER),
        score: 1,
        invalidatedAt: after(2500),
        createdAt: after(1500),
        updatedAt: after(2000),
      },
    ] satisfies AdminRatingRecord[]);
    expect(nextCursor).toBeNull();
  });

  test('更新の新しい順に並べ、同じ日時はIDの降順にする', async () => {
    await insertRatings([
      ratingAt(1, 3000, { user: RATER }),
      ratingAt(2, 1000, { user: OTHER_RATER }),
      ratingAt(3, 2000, { user: SUSPENDED }),
      ratingAt(4, 2000, { product: OTHER_PRODUCT }),
    ]);

    const { ratings } = await createDirectory().search({}, { limit: 10 });

    expect(idsOf(ratings)).toEqual([
      ratingIdOf(1),
      ratingIdOf(4),
      ratingIdOf(3),
      ratingIdOf(2),
    ]);
  });

  test('プロダクトで絞り込み、非公開化したプロダクトの評価も返す', async () => {
    await insertRatings([
      ratingAt(1, 1000),
      ratingAt(2, 2000, { product: OTHER_PRODUCT }),
      ratingAt(3, 3000, { product: HIDDEN_PRODUCT }),
    ]);
    const directory = createDirectory();

    const other = await directory.search(
      { productId: productIdOf(OTHER_PRODUCT) },
      { limit: 10 },
    );
    const hidden = await directory.search(
      { productId: productIdOf(HIDDEN_PRODUCT) },
      { limit: 10 },
    );

    expect(idsOf(other.ratings)).toEqual([ratingIdOf(2)]);
    expect(idsOf(hidden.ratings)).toEqual([ratingIdOf(3)]);
  });

  test('評価者で絞り込む', async () => {
    await insertRatings([
      ratingAt(1, 1000),
      ratingAt(2, 2000, { user: OTHER_RATER }),
      ratingAt(3, 3000, { product: OTHER_PRODUCT }),
    ]);

    const { ratings } = await createDirectory().search(
      { userId: userIdOf(RATER) },
      { limit: 10 },
    );

    expect(idsOf(ratings)).toEqual([ratingIdOf(3), ratingIdOf(1)]);
  });

  test('無効化の状態で絞り込み、評価者の停止は状態に含めない', async () => {
    await insertRatings([
      ratingAt(1, 1000),
      ratingAt(2, 2000, {
        user: OTHER_RATER,
        columns: { invalidatedAt: after(9000) },
      }),
      ratingAt(3, 3000, { user: SUSPENDED }),
      ratingAt(4, 4000, {
        product: OTHER_PRODUCT,
        columns: { invalidatedAt: after(9000) },
      }),
    ]);
    const directory = createDirectory();

    const valid = await directory.search({ state: 'valid' }, { limit: 10 });
    const invalidated = await directory.search(
      { state: 'invalidated' },
      { limit: 10 },
    );

    expect(idsOf(valid.ratings)).toEqual([ratingIdOf(3), ratingIdOf(1)]);
    expect(idsOf(invalidated.ratings)).toEqual([ratingIdOf(4), ratingIdOf(2)]);
  });

  test('複数の絞り込みは全てを満たす評価だけを返す', async () => {
    await insertRatings([
      ratingAt(1, 1000, { columns: { invalidatedAt: after(9000) } }),
      ratingAt(2, 2000, {
        user: OTHER_RATER,
        columns: { invalidatedAt: after(9000) },
      }),
      ratingAt(3, 3000, { product: OTHER_PRODUCT }),
    ]);

    const { ratings } = await createDirectory().search(
      {
        productId: productIdOf(PRODUCT),
        userId: userIdOf(RATER),
        state: 'invalidated',
      },
      { limit: 10 },
    );

    expect(idsOf(ratings)).toEqual([ratingIdOf(1)]);
  });

  test('退会で論理削除した評価を返さない', async () => {
    await insertRatings([
      ratingAt(1, 1000),
      ratingAt(2, 2000, {
        user: WITHDRAWN,
        columns: { deletedAt: after(9000) },
      }),
      ratingAt(3, 3000, {
        user: OTHER_RATER,
        columns: { deletedAt: after(9000), invalidatedAt: after(8000) },
      }),
    ]);
    const directory = createDirectory();

    const all = await directory.search({}, { limit: 10 });
    const byWithdrawn = await directory.search(
      { userId: userIdOf(WITHDRAWN) },
      { limit: 10 },
    );
    const invalidated = await directory.search(
      { state: 'invalidated' },
      { limit: 10 },
    );

    expect(idsOf(all.ratings)).toEqual([ratingIdOf(1)]);
    expect(byWithdrawn.ratings).toEqual([]);
    expect(invalidated.ratings).toEqual([]);
  });

  describe('ページ分け', () => {
    test('件数の上限まで返し、続きがあればカーソルを返す', async () => {
      await insertProducts(range(101, 201), OWNER);
      await insertRatings(
        range(101, 201).map((index) =>
          ratingAt(index, index * 10, { product: index }),
        ),
      );
      const directory = createDirectory();

      const largest = await directory.search({}, { limit: 100 });
      const smallest = await directory.search({}, { limit: 1 });

      expect(largest.ratings).toHaveLength(100);
      expect(largest.nextCursor).not.toBeNull();
      expect(idsOf(smallest.ratings)).toEqual([ratingIdOf(201)]);
      expect(smallest.nextCursor).not.toBeNull();
    });

    test('カーソルで続きを重複・欠落なく取得し、最後のページではカーソルを返さない', async () => {
      await insertRatings([
        ratingAt(1, 1000, { user: RATER }),
        ratingAt(2, 2000, { user: OTHER_RATER }),
        ratingAt(3, 2000, { user: SUSPENDED }),
        ratingAt(4, 2000, { product: OTHER_PRODUCT, user: RATER }),
        ratingAt(5, 3000, { product: OTHER_PRODUCT, user: OTHER_RATER }),
      ]);
      const directory = createDirectory();

      const first = await directory.search({}, { limit: 2 });
      const second = await directory.search(
        {},
        { limit: 2, after: first.nextCursor ?? undefined },
      );
      const third = await directory.search(
        {},
        { limit: 2, after: second.nextCursor ?? undefined },
      );

      expect(idsOf(first.ratings)).toEqual([ratingIdOf(5), ratingIdOf(4)]);
      expect(idsOf(second.ratings)).toEqual([ratingIdOf(3), ratingIdOf(2)]);
      expect(idsOf(third.ratings)).toEqual([ratingIdOf(1)]);
      expect(third.nextCursor).toBeNull();
    });

    test('カーソルは最後の評価の更新日時のミリ秒とIDをコロンでつないだbase64urlである', async () => {
      await insertRatings([
        ratingAt(1, 1000, { columns: { createdAt: after(10) } }),
        ratingAt(2, 2000, {
          user: OTHER_RATER,
          columns: { createdAt: after(20) },
        }),
      ]);

      const { nextCursor } = await createDirectory().search({}, { limit: 1 });

      expect(nextCursor).toBe(
        base64urlOf(`${String(after(2000).getTime())}:${ratingIdOf(2)}`),
      );
    });

    test('カーソルの続きにも絞り込みの条件を適用する', async () => {
      await insertRatings([
        ratingAt(1, 1000, { columns: { invalidatedAt: after(9000) } }),
        ratingAt(2, 2000, { user: OTHER_RATER }),
        ratingAt(3, 3000, {
          user: SUSPENDED,
          columns: { invalidatedAt: after(9000) },
        }),
      ]);
      const directory = createDirectory();

      const first = await directory.search(
        { state: 'invalidated' },
        { limit: 1 },
      );
      const second = await directory.search(
        { state: 'invalidated' },
        { limit: 1, after: first.nextCursor ?? undefined },
      );

      expect(idsOf(first.ratings)).toEqual([ratingIdOf(3)]);
      expect(idsOf(second.ratings)).toEqual([ratingIdOf(1)]);
      expect(second.nextCursor).toBeNull();
    });

    test.each([
      ['形式の違う文字列', 'not-a-cursor'],
      ['空文字列', ''],
      ['区切りの無い値', base64urlOf(`1730419200000${ratingIdOf(1)}`)],
      ['ミリ秒が数字でない値', base64urlOf(`abc:${ratingIdOf(1)}`)],
      ['IDの欠けた値', base64urlOf('1730419200000:')],
      ['パディング付きの値', `${base64urlOf(`1:${ratingIdOf(1)}`)}=`],
    ])(
      '不正なカーソル(%s)をページの位置の指定の誤りとして拒否する',
      async (_name, cursor) => {
        const searching = createDirectory().search(
          {},
          { limit: 10, after: cursor },
        );

        await expect(searching).rejects.toBeInstanceOf(AppError);
        await expect(searching).rejects.toMatchObject({
          kind: 'bad_request',
          code: 'invalid_cursor',
        });
      },
    );

    test.each([0, 101, 1.5])(
      '件数(%s)が1〜100の整数でなければ入力の誤りとして拒否する',
      async (limit) => {
        await expect(
          createDirectory().search({}, { limit }),
        ).rejects.toMatchObject({
          kind: 'bad_request',
          code: 'validation_error',
        });
      },
    );
  });

  test('D1への問い合わせに失敗したら例外にする', async () => {
    await expect(
      createDirectory(createFailingDatabase()).search({}, { limit: 10 }),
    ).rejects.toThrow();
  });
});

describe('D1AdminRatingDirectory.findByIds', () => {
  test('識別ごとの評価を返し、存在しない識別と退会で論理削除した評価を除く', async () => {
    await insertRatings([
      ratingAt(1, 1000, { score: 4 }),
      ratingAt(2, 2000, {
        user: OTHER_RATER,
        columns: { invalidatedAt: after(9000) },
      }),
      ratingAt(3, 3000, {
        user: WITHDRAWN,
        columns: { deletedAt: after(9000) },
      }),
    ]);

    const found = await createDirectory().findByIds([
      ratingIdOf(1),
      ratingIdOf(2),
      ratingIdOf(3),
      ratingIdOf(99),
      ratingIdOf(1),
    ]);

    expect([...found.keys()].toSorted()).toEqual([
      ratingIdOf(1),
      ratingIdOf(2),
    ]);
    expect(found.get(ratingIdOf(1))).toEqual({
      ratingId: ratingIdOf(1),
      productId: productIdOf(PRODUCT),
      userId: userIdOf(RATER),
      score: 4,
      invalidatedAt: null,
      createdAt: T0,
      updatedAt: after(1000),
    } satisfies AdminRatingRecord);
    expect(found.get(ratingIdOf(2))?.invalidatedAt).toEqual(after(9000));
  });

  test('識別が無ければ空を返す', async () => {
    await expect(createDirectory().findByIds([])).resolves.toEqual(new Map());
  });

  test('91件以上の識別も90件ずつ読んで全てを返す', async () => {
    const indexes = range(101, 281);
    await insertProducts(indexes, OWNER);
    await insertRatings(
      indexes.map((index) => ratingAt(index, index, { product: index })),
    );

    const found = await createDirectory().findByIds(indexes.map(ratingIdOf));

    expect(found.size).toBe(indexes.length);
    expect(found.get(ratingIdOf(101))?.productId).toBe(productIdOf(101));
    expect(found.get(ratingIdOf(281))?.productId).toBe(productIdOf(281));
  });

  test('D1への問い合わせに失敗したら例外にする', async () => {
    await expect(
      createDirectory(createFailingDatabase()).findByIds([ratingIdOf(1)]),
    ).rejects.toThrow();
  });
});
