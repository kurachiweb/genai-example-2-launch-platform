import { beforeEach, describe, expect, test } from 'vitest';

import { PRODUCT_CATEGORY_OTHER_ID } from '../../../common-lib/product/product-category-constants.ts';
import { AppError } from '../../core/errors/app-error.ts';
import type {
  AdminProductDirectory,
  AdminProductLaunchState,
  AdminProductRecord,
  AdminProductSearchFilter,
  AdminProductVisibility,
} from '../../core/product/ports.ts';
import {
  fromBusinessDateTime,
  parseBusinessDate,
} from '../../core/time/business-time.ts';
import { createFailingDatabase } from '../identity/testing/identity-store-fixtures.ts';
import { D1AdminProductDirectory } from './d1-admin-product-directory.ts';
import {
  after,
  categoryIdOf,
  clearProductTables,
  db,
  insertCategory,
  insertLaunch,
  insertProduct,
  insertProducts,
  insertUser,
  launchIdOf,
  logoFileIdOf,
  productIdOf,
  T0,
  userIdOf,
} from './testing/product-fixtures.ts';

const RECORD_FIELDS = [
  'productId',
  'ownerUserId',
  'handle',
  'name',
  'category',
  'logoFileId',
  'hiddenAt',
  'visibility',
  'latestLaunch',
  'createdAt',
] as const satisfies readonly (keyof AdminProductRecord)[];

const LAUNCH_STATES = [
  'scheduled',
  'in_progress',
  'won',
  'lost',
  'canceled',
] as const satisfies readonly AdminProductLaunchState[];

const VISIBILITIES = [
  'visible',
  'hidden',
  'owner_suspended',
] as const satisfies readonly AdminProductVisibility[];

const BASE64URL_OPTIONS = {
  alphabet: 'base64url',
  omitPadding: true,
} as const;

const textEncoder = new TextEncoder();

// 業務日付の2026-11-10の正午を「今」とし、ローンチの状態の境界をこの日付から組み立てる
const TODAY = parseBusinessDate('2026-11-10');
const NOW = fromBusinessDateTime(TODAY, { hour: 12, minute: 0 });

function base64urlOf(text: string): string {
  return textEncoder.encode(text).toBase64(BASE64URL_OPTIONS);
}

function createDirectory(database = db): AdminProductDirectory {
  return new D1AdminProductDirectory(database);
}

async function searchIds(
  filter: AdminProductSearchFilter,
  now = NOW,
): Promise<readonly string[]> {
  const { products } = await createDirectory().search(
    filter,
    { limit: 50 },
    now,
  );
  return products.map((product) => product.productId);
}

async function searchAll(now = NOW): Promise<readonly AdminProductRecord[]> {
  const { products } = await createDirectory().search({}, { limit: 50 }, now);
  return products;
}

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, offset) => from + offset);
}

// 最新のローンチの状態の5値と、ローンチの無いプロダクトを1件ずつ作る
async function seedLaunchStates(): Promise<void> {
  await insertUser(1);
  await insertProduct(1, 1, {
    latestLaunchDate: '2026-11-12',
    createdAt: after(1000),
  });
  await insertLaunch(1, 1, {
    launchDate: '2026-11-12',
    cancelledAt: after(500),
  });
  await insertProduct(2, 1, {
    latestLaunchDate: '2026-11-08',
    createdAt: after(2000),
  });
  await insertLaunch(2, 2, {
    launchDate: '2026-11-08',
    outcome: 'won',
    decidedAt: after(500),
  });
  await insertProduct(3, 1, {
    latestLaunchDate: '2026-11-08',
    createdAt: after(3000),
  });
  await insertLaunch(3, 3, {
    launchDate: '2026-11-08',
    outcome: 'lost',
    decidedAt: after(500),
  });
  await insertProduct(4, 1, {
    latestLaunchDate: '2026-11-11',
    createdAt: after(4000),
  });
  await insertLaunch(4, 4, { launchDate: '2026-11-11' });
  await insertProduct(5, 1, {
    latestLaunchDate: '2026-11-10',
    createdAt: after(5000),
  });
  await insertLaunch(5, 5, { launchDate: '2026-11-10' });
  await insertProduct(6, 1, {
    latestLaunchDate: '2026-11-09',
    createdAt: after(6000),
  });
  await insertLaunch(6, 6, { launchDate: '2026-11-09' });
  await insertProduct(7, 1, {
    latestLaunchDate: '2026-11-20',
    createdAt: after(7000),
  });
}

// 公開の状態の3値と、非公開化と投稿者の停止が重なるプロダクトを作る
async function seedVisibilities(): Promise<void> {
  await insertUser(1);
  await insertUser(2, { status: 'suspended', suspendedAt: after(100) });
  await insertProduct(1, 1, { createdAt: after(1000) });
  await insertProduct(2, 1, {
    createdAt: after(2000),
    hiddenAt: after(200),
  });
  await insertProduct(3, 2, { createdAt: after(3000) });
  await insertProduct(4, 2, {
    createdAt: after(4000),
    hiddenAt: after(300),
  });
}

beforeEach(async () => {
  await clearProductTables();
});

describe('D1AdminProductDirectory', () => {
  describe('search', () => {
    test('論理削除済みを除いて作成日時とIDの降順に並べる', async () => {
      await insertUser(1);
      await insertProduct(1, 1, { createdAt: after(1000) });
      await insertProduct(2, 1, { createdAt: after(3000) });
      await insertProduct(3, 1, { createdAt: after(2000) });
      await insertProduct(4, 1, { createdAt: after(2000) });
      await insertProduct(5, 1, {
        createdAt: after(4000),
        deletedAt: after(5000),
      });

      await expect(searchIds({})).resolves.toEqual([
        productIdOf(2),
        productIdOf(4),
        productIdOf(3),
        productIdOf(1),
      ]);
    });

    test('プロダクトの管理画面向けの項目を返し、説明文・外部URL・投稿者のメールアドレスを含めない', async () => {
      await insertUser(1);
      await insertCategory(1, { name: '開発ツール' });
      await insertProduct(1, 1, {
        handle: 'Alpha',
        name: 'アルファ',
        categoryId: categoryIdOf(1),
        latestLaunchDate: '2026-11-08',
        hiddenAt: after(800),
        createdAt: after(1000),
      });
      await insertLaunch(1, 1, {
        launchDate: '2026-11-08',
        outcome: 'won',
        decidedAt: after(500),
      });

      const [record] = await searchAll();

      expect(record).toEqual({
        productId: productIdOf(1),
        ownerUserId: userIdOf(1),
        handle: 'Alpha',
        name: 'アルファ',
        category: { id: categoryIdOf(1), name: '開発ツール' },
        logoFileId: logoFileIdOf(1),
        hiddenAt: after(800),
        visibility: 'hidden',
        latestLaunch: {
          launchId: launchIdOf(1),
          launchDate: parseBusinessDate('2026-11-08'),
          state: 'won',
        },
        createdAt: after(1000),
      });
      expect(Object.keys(record ?? {}).toSorted()).toEqual(
        [...RECORD_FIELDS].toSorted(),
      );
    });

    test('名称を大文字小文字を区別しない部分一致で絞り込む', async () => {
      await insertUser(1);
      await insertProduct(1, 1, { name: 'Alpha Tool' });
      await insertProduct(2, 1, { name: 'beta TOOLS' });
      await insertProduct(3, 1, { name: 'ガンマ' });

      await expect(searchIds({ name: 'tool' })).resolves.toEqual([
        productIdOf(2),
        productIdOf(1),
      ]);
      await expect(searchIds({ name: 'ンマ' })).resolves.toEqual([
        productIdOf(3),
      ]);
    });

    test('ハンドルを大文字小文字を区別しない部分一致で絞り込む', async () => {
      await insertUser(1);
      await insertProduct(1, 1, { handle: 'Launch-Kit' });
      await insertProduct(2, 1, { handle: 'kitchen' });
      await insertProduct(3, 1, { handle: 'other' });

      await expect(searchIds({ handle: 'KIT' })).resolves.toEqual([
        productIdOf(2),
        productIdOf(1),
      ]);
    });

    test.each([
      ['%', 1],
      ['_', 2],
      ['\\', 3],
    ])(
      '名称の`%s`をワイルドカードではなく文字として照合する',
      async (keyword, matched) => {
        await insertUser(1);
        await insertProduct(1, 1, { name: '100%果汁' });
        await insertProduct(2, 1, { name: 'snake_case' });
        await insertProduct(3, 1, { name: 'C:\\path' });
        await insertProduct(4, 1, { name: 'ふつうの名称' });

        await expect(searchIds({ name: keyword })).resolves.toEqual([
          productIdOf(matched),
        ]);
      },
    );

    test('ハンドルの`_`をワイルドカードではなく文字として照合する', async () => {
      await insertUser(1);
      await insertProduct(1, 1, { handle: 'a_b' });
      await insertProduct(2, 1, { handle: 'axb' });

      await expect(searchIds({ handle: 'a_b' })).resolves.toEqual([
        productIdOf(1),
      ]);
    });

    test('投稿者で絞り込む', async () => {
      await insertUser(1);
      await insertUser(2);
      await insertProduct(1, 1);
      await insertProduct(2, 2);

      await expect(searchIds({ ownerUserId: userIdOf(2) })).resolves.toEqual([
        productIdOf(2),
      ]);
    });

    test('カテゴリで絞り込む', async () => {
      await insertUser(1);
      await insertCategory(1);
      await insertProduct(1, 1, { categoryId: categoryIdOf(1) });
      await insertProduct(2, 1);

      await expect(searchIds({ categoryId: categoryIdOf(1) })).resolves.toEqual(
        [productIdOf(1)],
      );
      await expect(
        searchIds({ categoryId: PRODUCT_CATEGORY_OTHER_ID }),
      ).resolves.toEqual([productIdOf(2)]);
    });

    test('最新のローンチの状態を取消・勝利・敗北・明日以降の未確定・今日と過去の未確定の5値で返し、ローンチの無いプロダクトは空にする', async () => {
      await seedLaunchStates();

      const records = await searchAll();

      expect(
        records.map((record) => [record.productId, record.latestLaunch]),
      ).toEqual([
        [productIdOf(7), null],
        [
          productIdOf(6),
          {
            launchId: launchIdOf(6),
            launchDate: parseBusinessDate('2026-11-09'),
            state: 'in_progress',
          },
        ],
        [
          productIdOf(5),
          {
            launchId: launchIdOf(5),
            launchDate: parseBusinessDate('2026-11-10'),
            state: 'in_progress',
          },
        ],
        [
          productIdOf(4),
          {
            launchId: launchIdOf(4),
            launchDate: parseBusinessDate('2026-11-11'),
            state: 'scheduled',
          },
        ],
        [
          productIdOf(3),
          {
            launchId: launchIdOf(3),
            launchDate: parseBusinessDate('2026-11-08'),
            state: 'lost',
          },
        ],
        [
          productIdOf(2),
          {
            launchId: launchIdOf(2),
            launchDate: parseBusinessDate('2026-11-08'),
            state: 'won',
          },
        ],
        [
          productIdOf(1),
          {
            launchId: launchIdOf(1),
            launchDate: parseBusinessDate('2026-11-12'),
            state: 'canceled',
          },
        ],
      ]);
    });

    test.each(LAUNCH_STATES)(
      '最新のローンチの状態(%s)による絞り込みが返す値と同じ結果になり、ローンチの無いプロダクトは一致しない',
      async (state) => {
        await seedLaunchStates();

        const expected = (await searchAll())
          .filter((record) => record.latestLaunch?.state === state)
          .map((record) => record.productId);

        expect(expected.length).toBeGreaterThan(0);
        await expect(searchIds({ launchState: state })).resolves.toEqual(
          expected,
        );
      },
    );

    test.each([
      ['前日の23:59:59.999', 'scheduled', -1],
      ['当日の0:00', 'in_progress', 0],
    ] as const)(
      'ローンチ日の%sの時点では未確定のローンチを%sとして返して絞り込む',
      async (_name, state, offset) => {
        await insertUser(1);
        await insertProduct(1, 1, { latestLaunchDate: '2026-11-11' });
        await insertLaunch(1, 1, { launchDate: '2026-11-11' });
        const now = new Date(
          fromBusinessDateTime(parseBusinessDate('2026-11-11'), {
            hour: 0,
            minute: 0,
          }).getTime() + offset,
        );

        const [record] = await searchAll(now);

        expect(record?.latestLaunch?.state).toBe(state);
        await expect(searchIds({ launchState: state }, now)).resolves.toEqual([
          productIdOf(1),
        ]);
      },
    );

    test('組み合わせの締め切り(23:45)の後の翌日のローンチも明日以降の未確定として返す', async () => {
      await insertUser(1);
      await insertProduct(1, 1, { latestLaunchDate: '2026-11-11' });
      await insertLaunch(1, 1, { launchDate: '2026-11-11' });
      const now = fromBusinessDateTime(TODAY, { hour: 23, minute: 50 });

      const [record] = await searchAll(now);

      expect(record?.latestLaunch?.state).toBe('scheduled');
      await expect(
        searchIds({ launchState: 'scheduled' }, now),
      ).resolves.toEqual([productIdOf(1)]);
    });

    test('最新のローンチ日のローンチが複数あればIDの降順の先頭を採り、それより前の日のローンチは採らない', async () => {
      await insertUser(1);
      await insertProduct(1, 1, { latestLaunchDate: '2026-11-15' });
      await insertLaunch(1, 1, {
        launchDate: '2026-11-15',
        cancelledAt: after(100),
      });
      await insertLaunch(2, 1, { launchDate: '2026-11-15' });
      await insertLaunch(3, 1, {
        launchDate: '2026-11-08',
        outcome: 'won',
        decidedAt: after(200),
      });

      const [record] = await searchAll();

      expect(record?.latestLaunch).toEqual({
        launchId: launchIdOf(2),
        launchDate: parseBusinessDate('2026-11-15'),
        state: 'scheduled',
      });
      await expect(searchIds({ launchState: 'scheduled' })).resolves.toEqual([
        productIdOf(1),
      ]);
      await expect(searchIds({ launchState: 'won' })).resolves.toEqual([]);
      await expect(searchIds({ launchState: 'canceled' })).resolves.toEqual([]);
    });

    test('公開の状態を、非公開化を投稿者の停止より優先して3値で返す', async () => {
      await seedVisibilities();

      const records = await searchAll();

      expect(
        records.map((record) => [
          record.productId,
          record.visibility,
          record.hiddenAt,
        ]),
      ).toEqual([
        [productIdOf(4), 'hidden', after(300)],
        [productIdOf(3), 'owner_suspended', null],
        [productIdOf(2), 'hidden', after(200)],
        [productIdOf(1), 'visible', null],
      ]);
    });

    test.each(VISIBILITIES)(
      '公開の状態(%s)による絞り込みが返す値と同じ結果になる',
      async (visibility) => {
        await seedVisibilities();

        const expected = (await searchAll())
          .filter((record) => record.visibility === visibility)
          .map((record) => record.productId);

        expect(expected.length).toBeGreaterThan(0);
        await expect(searchIds({ visibility })).resolves.toEqual(expected);
      },
    );

    test('複数の条件をすべて満たすプロダクトだけを返す', async () => {
      await insertUser(1);
      await insertUser(2);
      await insertCategory(1);
      await insertProduct(1, 1, {
        name: 'Tool',
        categoryId: categoryIdOf(1),
        latestLaunchDate: '2026-11-11',
      });
      await insertLaunch(1, 1, { launchDate: '2026-11-11' });
      await insertProduct(2, 1, {
        name: 'Tool',
        categoryId: categoryIdOf(1),
        latestLaunchDate: '2026-11-11',
        hiddenAt: after(100),
      });
      await insertLaunch(2, 2, { launchDate: '2026-11-11' });
      await insertProduct(3, 2, {
        name: 'Tool',
        categoryId: categoryIdOf(1),
        latestLaunchDate: '2026-11-11',
      });
      await insertLaunch(3, 3, { launchDate: '2026-11-11' });
      await insertProduct(4, 1, {
        name: 'Other',
        categoryId: categoryIdOf(1),
        latestLaunchDate: '2026-11-11',
      });
      await insertLaunch(4, 4, { launchDate: '2026-11-11' });

      await expect(
        searchIds({
          name: 'tool',
          handle: 'product',
          ownerUserId: userIdOf(1),
          categoryId: categoryIdOf(1),
          launchState: 'scheduled',
          visibility: 'visible',
        }),
      ).resolves.toEqual([productIdOf(1)]);
    });

    test.each([0, 51, 1.5, -1, Number.NaN])(
      '件数(%s)が1〜50の整数でなければ入力の誤りとして拒否する',
      async (limit) => {
        const searching = createDirectory().search({}, { limit }, NOW);

        await expect(searching).rejects.toBeInstanceOf(AppError);
        await expect(searching).rejects.toMatchObject({
          kind: 'bad_request',
          code: 'validation_error',
        });
      },
    );

    test.each([
      [1, 1],
      [50, 50],
    ])(
      '件数の上限(%s)ちょうどまで返し、続きがあればカーソルを返す',
      async (limit, expected) => {
        await insertUser(1);
        await insertProducts(range(1, 51), 1);

        const { products, nextCursor } = await createDirectory().search(
          {},
          { limit },
          NOW,
        );

        expect(products).toHaveLength(expected);
        expect(nextCursor).not.toBeNull();
      },
    );

    test('カーソルで続きを取得し、最後のページではカーソルを返さない', async () => {
      await insertUser(1);
      await insertProduct(1, 1, { createdAt: after(1000) });
      await insertProduct(2, 1, { createdAt: after(2000) });
      await insertProduct(3, 1, { createdAt: after(2000) });
      await insertProduct(4, 1, { createdAt: after(2000) });
      await insertProduct(5, 1, { createdAt: after(3000) });
      const directory = createDirectory();

      const first = await directory.search({}, { limit: 2 }, NOW);
      const second = await directory.search(
        {},
        { limit: 2, after: first.nextCursor ?? undefined },
        NOW,
      );
      const third = await directory.search(
        {},
        { limit: 2, after: second.nextCursor ?? undefined },
        NOW,
      );

      expect(first.products.map((product) => product.productId)).toEqual([
        productIdOf(5),
        productIdOf(4),
      ]);
      expect(second.products.map((product) => product.productId)).toEqual([
        productIdOf(3),
        productIdOf(2),
      ]);
      expect(third.products.map((product) => product.productId)).toEqual([
        productIdOf(1),
      ]);
      expect(third.nextCursor).toBeNull();
    });

    test('続きが無い件数ちょうどのページではカーソルを返さない', async () => {
      await insertUser(1);
      await insertProducts([1, 2], 1);

      const { products, nextCursor } = await createDirectory().search(
        {},
        { limit: 2 },
        NOW,
      );

      expect(products).toHaveLength(2);
      expect(nextCursor).toBeNull();
    });

    test('カーソルは最後のプロダクトの作成日時のミリ秒とIDをコロンでつないだbase64urlである', async () => {
      await insertUser(1);
      await insertProduct(1, 1, { createdAt: after(1000) });
      await insertProduct(2, 1, { createdAt: after(2000) });

      const { nextCursor } = await createDirectory().search(
        {},
        { limit: 1 },
        NOW,
      );

      expect(nextCursor).toBe(
        base64urlOf(`${String(after(2000).getTime())}:${productIdOf(2)}`),
      );
    });

    test('カーソルの続きにも絞り込みの条件を適用する', async () => {
      await insertUser(1);
      await insertProduct(1, 1, { createdAt: after(1000) });
      await insertProduct(2, 1, {
        createdAt: after(2000),
        hiddenAt: after(100),
      });
      await insertProduct(3, 1, { createdAt: after(3000) });
      await insertProduct(4, 1, {
        createdAt: after(4000),
        hiddenAt: after(100),
      });
      const directory = createDirectory();

      const first = await directory.search(
        { visibility: 'hidden' },
        { limit: 1 },
        NOW,
      );
      const second = await directory.search(
        { visibility: 'hidden' },
        { limit: 1, after: first.nextCursor ?? undefined },
        NOW,
      );

      expect(first.products.map((product) => product.productId)).toEqual([
        productIdOf(4),
      ]);
      expect(second.products.map((product) => product.productId)).toEqual([
        productIdOf(2),
      ]);
      expect(second.nextCursor).toBeNull();
    });

    test.each([
      ['形式の違う文字列', 'not-a-cursor'],
      ['空文字列', ''],
      ['区切りの無い値', base64urlOf(`1730419200000${productIdOf(1)}`)],
      ['ミリ秒が数字でない値', base64urlOf(`abc:${productIdOf(1)}`)],
      ['IDの欠けた値', base64urlOf('1730419200000:')],
      ['IDの長さが違う値', base64urlOf('1730419200000:01JD0PROD')],
      ['パディング付きの値', `${base64urlOf(`1:${productIdOf(1)}`)}=`],
      ['base64urlでない文字を含む値', `${base64urlOf(`1:${productIdOf(1)}`)}+`],
    ])(
      '不正なカーソル(%s)をページの位置の指定の誤りとして拒否する',
      async (_name, cursor) => {
        const searching = createDirectory().search(
          {},
          { limit: 10, after: cursor },
          NOW,
        );

        await expect(searching).rejects.toBeInstanceOf(AppError);
        await expect(searching).rejects.toMatchObject({
          kind: 'bad_request',
          code: 'invalid_cursor',
          message: 'ページの位置の指定が正しくありません。',
        });
      },
    );

    test('D1への問い合わせに失敗したら例外にする', async () => {
      await expect(
        createDirectory(createFailingDatabase()).search({}, { limit: 10 }, NOW),
      ).rejects.toThrow();
    });
  });

  describe('countRegisteredAt', () => {
    test('時点より前に登録し、時点で論理削除していないプロダクトを数える', async () => {
      const at = after(10_000);
      await insertUser(1);
      await insertProduct(1, 1, { createdAt: after(1000) });
      await insertProduct(2, 1, { createdAt: after(9999) });
      await insertProduct(3, 1, { createdAt: at });
      await insertProduct(4, 1, { createdAt: after(10_001) });
      await insertProduct(5, 1, {
        createdAt: after(1000),
        deletedAt: after(9999),
      });
      await insertProduct(6, 1, { createdAt: after(1000), deletedAt: at });
      await insertProduct(7, 1, {
        createdAt: after(1000),
        deletedAt: after(20_000),
      });
      await insertProduct(8, 1, {
        createdAt: after(1000),
        hiddenAt: after(2000),
      });

      await expect(createDirectory().countRegisteredAt(at)).resolves.toBe(5);
    });

    test('プロダクトが無ければ0を返す', async () => {
      await expect(createDirectory().countRegisteredAt(T0)).resolves.toBe(0);
    });

    test('D1への問い合わせに失敗したら例外にする', async () => {
      await expect(
        createDirectory(createFailingDatabase()).countRegisteredAt(T0),
      ).rejects.toThrow();
    });
  });
});
