import { env } from 'cloudflare:workers';
import { asc } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';

import {
  PRODUCT_CATEGORY_CREATE_ACTION,
  PRODUCT_CATEGORY_DELETE_ACTION,
  PRODUCT_CATEGORY_UPDATE_ACTION,
} from '../../../common-lib/admin/audit-actions/product-launch.ts';
import {
  PRODUCT_CATEGORY_OTHER_HANDLE,
  PRODUCT_CATEGORY_OTHER_ID,
  PRODUCT_CATEGORY_OTHER_NAME,
} from '../../../common-lib/product/product-category-constants.ts';
import { createDatabase } from '../../../db/client.ts';
import { productCategories } from '../../../db/schema/product/product-categories.ts';
import { productPreviousHandles } from '../../../db/schema/product/product-previous-handles.ts';
import type { PreparedAuditEntry } from '../../../lib/core/admin/audit-log.ts';
import type { IdGenerator } from '../../../lib/core/ids/id-generator.ts';
import { D1ProductCategoryDirectory } from '../../../lib/workers/product/d1-product-category-directory.ts';
import {
  after,
  categoryIdOf,
  clearProductTables,
  db,
  insertCategory,
  insertProduct,
  insertUser,
  PRODUCT_CATEGORY_SEED_ROW,
  restoreProductCategorySeed,
  T0,
} from '../../../lib/workers/product/testing/product-fixtures.ts';
import { createBatchRecordingD1 } from '../../../test/support/batch-recording-d1.ts';
import type { ProductCategoryStore } from '../../application/product/ports.ts';
import {
  adminIdOf,
  auditLogIdOf,
  clearAdminTables,
  createAuditLogRecorder,
  createSequentialAuditLogIds,
  readAuditLogSummaries,
  readAuditLogTargetIds,
} from '../admin/testing/admin-store-fixtures.ts';
import { D1ProductCategoryStore } from './d1-product-category-store.ts';

const OPERATOR = 1;
const OWNER = 1;

// 1つのテストの中で準備する監査ログの識別子を1から順に振る
let auditLogIds: IdGenerator = createSequentialAuditLogIds();

function auditOf(action: string, categoryId: string): PreparedAuditEntry {
  return createAuditLogRecorder({ ids: auditLogIds }).prepare({
    operatorAdminId: adminIdOf(OPERATOR),
    action,
    targetIds: [categoryId],
    occurredAt: after(60_000),
  });
}

const createAudit = (categoryId: string): PreparedAuditEntry =>
  auditOf(PRODUCT_CATEGORY_CREATE_ACTION.name, categoryId);

const updateAudit = (categoryId: string): PreparedAuditEntry =>
  auditOf(PRODUCT_CATEGORY_UPDATE_ACTION.name, categoryId);

const deleteAudit = (categoryId: string): PreparedAuditEntry =>
  auditOf(PRODUCT_CATEGORY_DELETE_ACTION.name, categoryId);

function createStore(): ProductCategoryStore {
  return new D1ProductCategoryStore(db);
}

function createRecordingStore() {
  const recording = createBatchRecordingD1(env.DB);
  return {
    recording,
    store: new D1ProductCategoryStore(createDatabase(recording.d1)),
  };
}

async function readCategoryRows() {
  return db.select().from(productCategories).orderBy(asc(productCategories.id));
}

async function readCategoryRow(id: string) {
  const rows = await readCategoryRows();
  return rows.find((row) => row.id === id);
}

function auditSummaryOf(index: number, action: string) {
  return {
    id: auditLogIdOf(index),
    operatorAdminId: adminIdOf(OPERATOR),
    action,
    detail: {},
  };
}

beforeEach(async () => {
  auditLogIds = createSequentialAuditLogIds();
  await clearProductTables();
  await restoreProductCategorySeed();
  await clearAdminTables();
});

describe('D1ProductCategoryStore', () => {
  describe('初期データ', () => {
    test('標準カテゴリ「その他」がマイグレーションと同じ固定のID・名前・ハンドル・日時で1件だけある', async () => {
      await expect(readCategoryRows()).resolves.toEqual([
        {
          id: PRODUCT_CATEGORY_OTHER_ID,
          name: PRODUCT_CATEGORY_OTHER_NAME,
          handle: PRODUCT_CATEGORY_OTHER_HANDLE,
          systemDefault: true,
          createdAt: PRODUCT_CATEGORY_SEED_ROW.createdAt,
          updatedAt: PRODUCT_CATEGORY_SEED_ROW.updatedAt,
        },
      ]);
    });
  });

  describe('list・findById', () => {
    test('追加の順に並べ、標準カテゴリ「その他」を末尾に置く', async () => {
      await insertCategory(2, { createdAt: after(2) });
      await insertCategory(1, { createdAt: after(1) });
      await insertCategory(3, { createdAt: after(2) });

      const categories = await createStore().list();

      expect(categories.map((category) => category.id)).toEqual([
        categoryIdOf(1),
        categoryIdOf(2),
        categoryIdOf(3),
        PRODUCT_CATEGORY_OTHER_ID,
      ]);
    });

    test('IDでカテゴリを返し、無ければundefinedを返す', async () => {
      await insertCategory(1, { createdAt: after(1) });

      await expect(createStore().findById(categoryIdOf(1))).resolves.toEqual({
        id: categoryIdOf(1),
        name: 'カテゴリ1',
        handle: 'category1',
        systemDefault: false,
        createdAt: after(1),
      });
      await expect(
        createStore().findById(categoryIdOf(9)),
      ).resolves.toBeUndefined();
    });
  });

  describe('insert', () => {
    test('カテゴリと追加の監査ログを1つの一括の書き込みで確定する', async () => {
      const { recording, store } = createRecordingStore();

      const result = await store.insert(
        {
          id: categoryIdOf(1),
          name: '開発ツール',
          handle: 'Dev-Tools',
          at: T0,
        },
        createAudit(categoryIdOf(1)),
      );

      expect(result).toBe('created');
      await expect(readCategoryRow(categoryIdOf(1))).resolves.toEqual({
        id: categoryIdOf(1),
        name: '開発ツール',
        handle: 'Dev-Tools',
        systemDefault: false,
        createdAt: T0,
        updatedAt: T0,
      });
      await expect(readAuditLogSummaries()).resolves.toEqual([
        auditSummaryOf(1, PRODUCT_CATEGORY_CREATE_ACTION.name),
      ]);
      await expect(readAuditLogTargetIds()).resolves.toEqual([categoryIdOf(1)]);
      expect(recording.batches).toHaveLength(1);
      expect(recording.statementsOutsideBatches()).toEqual([]);
    });

    test.each([['カテゴリ1'], ['Developer Tools'], ['DEVELOPER TOOLS']])(
      '大文字小文字を区別せずに他のカテゴリと同じ名前%sはname-takenを返し、カテゴリも監査ログも残さない',
      async (name) => {
        await insertCategory(1);
        await insertCategory(2, { name: 'developer tools' });

        const result = await createStore().insert(
          { id: categoryIdOf(3), name, handle: 'tools', at: T0 },
          createAudit(categoryIdOf(3)),
        );

        expect(result).toBe('name-taken');
        await expect(readCategoryRow(categoryIdOf(3))).resolves.toBeUndefined();
        await expect(readAuditLogSummaries()).resolves.toEqual([]);
      },
    );

    test('標準カテゴリと同じ名前はname-takenを返す', async () => {
      const result = await createStore().insert(
        {
          id: categoryIdOf(1),
          name: PRODUCT_CATEGORY_OTHER_NAME,
          handle: 'misc',
          at: T0,
        },
        createAudit(categoryIdOf(1)),
      );

      expect(result).toBe('name-taken');
      await expect(readAuditLogSummaries()).resolves.toEqual([]);
    });

    test.each([['category1'], ['Category1'], ['OTHER']])(
      '大文字小文字を区別せずに他のカテゴリと同じハンドル%sはhandle-takenを返し、カテゴリも監査ログも残さない',
      async (handle) => {
        await insertCategory(1);

        const result = await createStore().insert(
          { id: categoryIdOf(2), name: '新しいカテゴリ', handle, at: T0 },
          createAudit(categoryIdOf(2)),
        );

        expect(result).toBe('handle-taken');
        await expect(readCategoryRow(categoryIdOf(2))).resolves.toBeUndefined();
        await expect(readAuditLogSummaries()).resolves.toEqual([]);
      },
    );
  });

  describe('update', () => {
    test('名前とハンドルと更新日時を、変更の監査ログと1つの一括の書き込みで確定する', async () => {
      await insertCategory(1);
      const { recording, store } = createRecordingStore();

      const result = await store.update(
        {
          id: categoryIdOf(1),
          name: '開発ツール',
          handle: 'dev-tools',
          at: after(5),
        },
        updateAudit(categoryIdOf(1)),
      );

      expect(result).toBe('updated');
      await expect(readCategoryRow(categoryIdOf(1))).resolves.toEqual({
        id: categoryIdOf(1),
        name: '開発ツール',
        handle: 'dev-tools',
        systemDefault: false,
        createdAt: T0,
        updatedAt: after(5),
      });
      await expect(readAuditLogSummaries()).resolves.toEqual([
        auditSummaryOf(1, PRODUCT_CATEGORY_UPDATE_ACTION.name),
      ]);
      await expect(readAuditLogTargetIds()).resolves.toEqual([categoryIdOf(1)]);
      expect(recording.batches).toHaveLength(1);
      expect(recording.statementsOutsideBatches()).toEqual([]);
    });

    test('ハンドルの変更で変更前のハンドルを保持せず、変更前のハンドルでは解決できず他のカテゴリが使える', async () => {
      await insertCategory(1);

      await createStore().update(
        {
          id: categoryIdOf(1),
          name: 'カテゴリ1',
          handle: 'renamed',
          at: after(5),
        },
        updateAudit(categoryIdOf(1)),
      );

      const directory = new D1ProductCategoryDirectory(db);
      await expect(
        directory.findByHandle('category1'),
      ).resolves.toBeUndefined();
      await expect(directory.findByHandle('RENAMED')).resolves.toMatchObject({
        id: categoryIdOf(1),
      });
      await expect(db.select().from(productPreviousHandles)).resolves.toEqual(
        [],
      );
      await expect(
        createStore().insert(
          {
            id: categoryIdOf(2),
            name: '別のカテゴリ',
            handle: 'category1',
            at: after(6),
          },
          createAudit(categoryIdOf(2)),
        ),
      ).resolves.toBe('created');
    });

    test('自分の名前とハンドルの大文字小文字だけを変える変更は確定する', async () => {
      await insertCategory(1, { name: 'ai tools', handle: 'ai' });

      const result = await createStore().update(
        { id: categoryIdOf(1), name: 'AI Tools', handle: 'AI', at: after(5) },
        updateAudit(categoryIdOf(1)),
      );

      expect(result).toBe('updated');
      await expect(readCategoryRow(categoryIdOf(1))).resolves.toMatchObject({
        name: 'AI Tools',
        handle: 'AI',
      });
    });

    test.each([
      ['名前', { name: 'カテゴリ2', handle: 'fresh' }, 'name-taken'],
      [
        '名前(大文字小文字の違い)',
        { name: 'TOOLS', handle: 'fresh' },
        'name-taken',
      ],
      ['ハンドル', { name: '新しい名前', handle: 'CATEGORY2' }, 'handle-taken'],
      [
        'ハンドル(標準カテゴリ)',
        { name: '新しい名前', handle: 'Other' },
        'handle-taken',
      ],
    ] as const)(
      '他のカテゴリと同じ%sは%sを返し、変更も監査ログも残さない',
      async (_, input, expected) => {
        await insertCategory(1);
        await insertCategory(2, { name: 'カテゴリ2' });
        await insertCategory(3, { name: 'tools' });

        const result = await createStore().update(
          { id: categoryIdOf(1), ...input, at: after(5) },
          updateAudit(categoryIdOf(1)),
        );

        expect(result).toBe(expected);
        await expect(readCategoryRow(categoryIdOf(1))).resolves.toMatchObject({
          name: 'カテゴリ1',
          handle: 'category1',
          updatedAt: T0,
        });
        await expect(readAuditLogSummaries()).resolves.toEqual([]);
      },
    );

    test.each([
      ['名前', { name: '雑多', handle: PRODUCT_CATEGORY_OTHER_HANDLE }],
      ['ハンドル', { name: PRODUCT_CATEGORY_OTHER_NAME, handle: 'misc' }],
    ])(
      '標準カテゴリ「その他」の%sの変更はprotectedを返し、行も監査ログも変えない',
      async (_, input) => {
        const result = await createStore().update(
          { id: PRODUCT_CATEGORY_OTHER_ID, ...input, at: after(5) },
          updateAudit(PRODUCT_CATEGORY_OTHER_ID),
        );

        expect(result).toBe('protected');
        await expect(readCategoryRows()).resolves.toEqual([
          PRODUCT_CATEGORY_SEED_ROW,
        ]);
        await expect(readAuditLogSummaries()).resolves.toEqual([]);
      },
    );

    test('存在しないカテゴリはnot-foundを返し、監査ログを残さない', async () => {
      const result = await createStore().update(
        { id: categoryIdOf(9), name: '名前', handle: 'name', at: after(5) },
        updateAudit(categoryIdOf(9)),
      );

      expect(result).toBe('not-found');
      await expect(readAuditLogSummaries()).resolves.toEqual([]);
    });
  });

  describe('delete', () => {
    test('紐付くプロダクトの無いカテゴリを、削除の監査ログと1つの一括の書き込みで削除する', async () => {
      await insertCategory(1);
      await insertCategory(2);
      const { recording, store } = createRecordingStore();

      const result = await store.delete(
        categoryIdOf(1),
        deleteAudit(categoryIdOf(1)),
      );

      expect(result).toBe('deleted');
      await expect(readCategoryRow(categoryIdOf(1))).resolves.toBeUndefined();
      await expect(readCategoryRow(categoryIdOf(2))).resolves.toBeDefined();
      await expect(readAuditLogSummaries()).resolves.toEqual([
        auditSummaryOf(1, PRODUCT_CATEGORY_DELETE_ACTION.name),
      ]);
      await expect(readAuditLogTargetIds()).resolves.toEqual([categoryIdOf(1)]);
      expect(recording.batches).toHaveLength(1);
      expect(recording.statementsOutsideBatches()).toEqual([]);
    });

    test.each([
      ['公開中の', {}],
      ['非公開化中の', { hiddenAt: after(1) }],
      ['論理削除後に物理削除されていない', { deletedAt: after(1) }],
    ])(
      '%sプロダクトが紐付くカテゴリはin-useを返し、カテゴリも残して監査ログを残さない',
      async (_, columns) => {
        await insertUser(OWNER);
        await insertCategory(1);
        await insertProduct(1, OWNER, {
          categoryId: categoryIdOf(1),
          ...columns,
        });

        const result = await createStore().delete(
          categoryIdOf(1),
          deleteAudit(categoryIdOf(1)),
        );

        expect(result).toBe('in-use');
        await expect(readCategoryRow(categoryIdOf(1))).resolves.toBeDefined();
        await expect(readAuditLogSummaries()).resolves.toEqual([]);
      },
    );

    test('他のカテゴリに紐付くプロダクトは削除を妨げない', async () => {
      await insertUser(OWNER);
      await insertCategory(1);
      await insertProduct(1, OWNER);

      await expect(
        createStore().delete(categoryIdOf(1), deleteAudit(categoryIdOf(1))),
      ).resolves.toBe('deleted');
    });

    test('標準カテゴリ「その他」はprotectedを返し、行も監査ログも残さない', async () => {
      const result = await createStore().delete(
        PRODUCT_CATEGORY_OTHER_ID,
        deleteAudit(PRODUCT_CATEGORY_OTHER_ID),
      );

      expect(result).toBe('protected');
      await expect(readCategoryRows()).resolves.toEqual([
        PRODUCT_CATEGORY_SEED_ROW,
      ]);
      await expect(readAuditLogSummaries()).resolves.toEqual([]);
    });

    test('プロダクトが紐付く標準カテゴリも、紐付きより先にprotectedを返す', async () => {
      await insertUser(OWNER);
      await insertProduct(1, OWNER);

      await expect(
        createStore().delete(
          PRODUCT_CATEGORY_OTHER_ID,
          deleteAudit(PRODUCT_CATEGORY_OTHER_ID),
        ),
      ).resolves.toBe('protected');
    });

    test('存在しないカテゴリはnot-foundを返し、監査ログを残さない', async () => {
      const result = await createStore().delete(
        categoryIdOf(9),
        deleteAudit(categoryIdOf(9)),
      );

      expect(result).toBe('not-found');
      await expect(readAuditLogSummaries()).resolves.toEqual([]);
    });
  });
});
