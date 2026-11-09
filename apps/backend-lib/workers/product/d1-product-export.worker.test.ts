import { beforeEach, describe, expect, test } from 'vitest';

import { D1LaunchExport, D1ProductExport } from './d1-product-export.ts';
import {
  after,
  categoryIdOf,
  clearProductTables,
  db,
  insertCategory,
  insertLaunch,
  insertProduct,
  insertScreenshot,
  insertUser,
  launchIdOf,
  logoFileIdOf,
  productIdOf,
  userIdOf,
} from './testing/product-fixtures.ts';

// 業務時刻(UTC-8)で2026-11-09 23:50。組み合わせの確定(23:45)の後のため、翌日のローンチは組み合わせ済みになる
const NOW = new Date('2026-11-10T07:50:00.000Z');

const productExport = new D1ProductExport(db);
const launchExport = new D1LaunchExport(db);

function screenshotFileIdOf(index: number): string {
  return `01JD0SFIL${String(index).padStart(17, '0')}`;
}

beforeEach(async () => {
  await clearProductTables();
  await insertUser(1, { handle: 'alice' });
  await insertUser(2, { handle: 'bob' });
  await insertCategory(1, { name: '開発ツール', handle: 'dev-tools' });
});

describe('ProductExport.listByUser', () => {
  beforeEach(async () => {
    await insertProduct(3, 1, {
      createdAt: after(1),
      updatedAt: after(11),
      deletedAt: after(21),
    });
    await insertProduct(1, 1, {
      handle: 'My-App',
      categoryId: categoryIdOf(1),
      createdAt: after(2),
      updatedAt: after(12),
    });
    await insertScreenshot(1, 1, 1, screenshotFileIdOf(2));
    await insertScreenshot(2, 1, 0, screenshotFileIdOf(1));
    await insertScreenshot(3, 3, 0, screenshotFileIdOf(3));
    await insertProduct(2, 1, {
      createdAt: after(2),
      updatedAt: after(13),
      hiddenAt: after(30),
    });
    await insertProduct(4, 2, { createdAt: after(1) });
    await insertScreenshot(4, 4, 0, screenshotFileIdOf(4));
  });

  test('論理削除済みと非公開化中を含む自分の全プロダクトを、作成の順に項目付きで返す', async () => {
    const records = await productExport.listByUser(userIdOf(1));

    expect(records).toEqual([
      {
        id: productIdOf(3),
        handle: 'product3',
        name: 'プロダクト3',
        tagline: 'タグライン3',
        categoryName: 'その他',
        websiteUrl: 'https://product3.example/',
        descriptionMarkdown: '説明文3',
        logoFileId: logoFileIdOf(3),
        screenshotFileIds: [screenshotFileIdOf(3)],
        createdAt: after(1),
        updatedAt: after(11),
        deletedAt: after(21),
        hiddenByAdmin: false,
      },
      {
        id: productIdOf(1),
        handle: 'My-App',
        name: 'プロダクト1',
        tagline: 'タグライン1',
        categoryName: '開発ツール',
        websiteUrl: 'https://product1.example/',
        descriptionMarkdown: '説明文1',
        logoFileId: logoFileIdOf(1),
        screenshotFileIds: [screenshotFileIdOf(1), screenshotFileIdOf(2)],
        createdAt: after(2),
        updatedAt: after(12),
        deletedAt: null,
        hiddenByAdmin: false,
      },
      {
        id: productIdOf(2),
        handle: 'product2',
        name: 'プロダクト2',
        tagline: 'タグライン2',
        categoryName: 'その他',
        websiteUrl: 'https://product2.example/',
        descriptionMarkdown: '説明文2',
        logoFileId: logoFileIdOf(2),
        screenshotFileIds: [],
        createdAt: after(2),
        updatedAt: after(13),
        deletedAt: null,
        hiddenByAdmin: true,
      },
    ]);
  });

  test('プロダクトの無い利用者には空の一覧を返す', async () => {
    await insertUser(3, { handle: 'carol' });

    expect(await productExport.listByUser(userIdOf(3))).toEqual([]);
  });
});

describe('LaunchExport.listByUser', () => {
  test('論理削除したプロダクトのローンチを含む自分の全ローンチを、ローンチ日とIDの古い順に照会の時点の状態付きで返す', async () => {
    await insertProduct(1, 1);
    await insertLaunch(5, 1, {
      launchDate: '2026-11-01',
      outcome: 'won',
      decidedAt: after(10),
    });
    await insertLaunch(6, 1, {
      launchDate: '2026-11-05',
      cancelledAt: after(11),
    });
    await insertLaunch(7, 1, { launchDate: '2026-11-09' });
    await insertProduct(2, 1, { hiddenAt: after(12) });
    await insertLaunch(2, 2, {
      launchDate: '2026-11-01',
      outcome: 'lost',
      decidedAt: after(13),
    });
    await insertLaunch(8, 2, { launchDate: '2026-11-10' });
    await insertProduct(3, 1, { deletedAt: after(14) });
    await insertLaunch(9, 3, { launchDate: '2026-11-20' });
    await insertLaunch(1, 3, {
      launchDate: '2026-10-01',
      outcome: 'lost',
      decidedAt: after(15),
    });
    await insertProduct(4, 2);
    await insertLaunch(4, 4, { launchDate: '2026-11-20' });

    const records = await launchExport.listByUser(userIdOf(1), NOW);

    expect(records).toEqual([
      {
        id: launchIdOf(1),
        productId: productIdOf(3),
        launchDate: '2026-10-01',
        status: 'finished',
      },
      {
        id: launchIdOf(2),
        productId: productIdOf(2),
        launchDate: '2026-11-01',
        status: 'finished',
      },
      {
        id: launchIdOf(5),
        productId: productIdOf(1),
        launchDate: '2026-11-01',
        status: 'finished',
      },
      {
        id: launchIdOf(6),
        productId: productIdOf(1),
        launchDate: '2026-11-05',
        status: 'canceled',
      },
      {
        id: launchIdOf(7),
        productId: productIdOf(1),
        launchDate: '2026-11-09',
        status: 'in_progress',
      },
      {
        id: launchIdOf(8),
        productId: productIdOf(2),
        launchDate: '2026-11-10',
        status: 'paired',
      },
      {
        id: launchIdOf(9),
        productId: productIdOf(3),
        launchDate: '2026-11-20',
        status: 'scheduled',
      },
    ]);
  });

  test('ローンチの無い利用者には空の一覧を返す', async () => {
    await insertProduct(1, 1);

    expect(await launchExport.listByUser(userIdOf(1), NOW)).toEqual([]);
  });
});
