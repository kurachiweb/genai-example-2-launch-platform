import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, test } from 'vitest';

import {
  INQUIRY_CATEGORY_CREATE_ACTION,
  INQUIRY_CATEGORY_DELETE_ACTION,
  INQUIRY_CATEGORY_RENAME_ACTION,
} from '../../../common-lib/admin/audit-actions/inquiry-chat.ts';
import {
  INQUIRY_CATEGORY_OTHER_ID,
  INQUIRY_CATEGORY_OTHER_NAME,
} from '../../../common-lib/inquiry/inquiry-category-constants.ts';
import { createDatabase } from '../../../db/client.ts';
import type { PreparedAuditEntry } from '../../../lib/core/admin/audit-log.ts';
import {
  clearIdentityTables,
  insertUser,
} from '../../../lib/workers/identity/testing/identity-store-fixtures.ts';
import { createBatchRecordingD1 } from '../../../test/support/batch-recording-d1.ts';
import type { InquiryCategoryStore } from '../../application/inquiry/ports.ts';
import { D1InquiryCategoryStore } from './d1-inquiry-category-store.ts';
import {
  after,
  auditLogIdOf,
  categoryIdOf,
  db,
  guestInquiryIdOf,
  insertCategory,
  insertGuestInquiry,
  insertMemberInquiry,
  memberInquiryIdOf,
  OPERATOR_ADMIN_ID,
  preparedAuditEntryOf,
  readAuditLogs,
  readCategoryRows,
  readGuestInquiryCategoryIds,
  readMemberInquiryCategoryIds,
  resetInquiryTables,
  T0,
} from './testing/inquiry-store-fixtures.ts';

const SEEDED_OTHER_CREATED_AT = new Date(1_730_871_820_288);

// Drizzleの失敗はD1のエラーをcauseに持つため、原因をたどって文言を集める
async function failureMessagesOf(write: Promise<unknown>): Promise<string[]> {
  const messages: string[] = [];
  try {
    await write;
  } catch (error) {
    for (
      let current = error;
      current instanceof Error;
      current = current.cause
    ) {
      messages.push(current.message);
    }
  }
  return messages;
}

function createStore(): InquiryCategoryStore {
  return new D1InquiryCategoryStore(db);
}

function auditOf(
  index: number,
  action: string,
  categoryId: string,
  detail?: Readonly<Record<string, string>>,
): PreparedAuditEntry {
  return preparedAuditEntryOf(index, {
    action,
    targetKind: 'category',
    targetIds: [categoryId],
    ...(detail === undefined ? {} : { detail }),
  });
}

function createAuditOf(index: number, categoryId: string): PreparedAuditEntry {
  return auditOf(index, INQUIRY_CATEGORY_CREATE_ACTION.name, categoryId);
}

function renameAuditOf(index: number, categoryId: string): PreparedAuditEntry {
  return auditOf(index, INQUIRY_CATEGORY_RENAME_ACTION.name, categoryId);
}

function deleteAuditOf(
  index: number,
  categoryId: string,
  reassignedCount: number,
): PreparedAuditEntry {
  return auditOf(index, INQUIRY_CATEGORY_DELETE_ACTION.name, categoryId, {
    reassignedCount: String(reassignedCount),
  });
}

// 標準カテゴリ以外に、紐付く問い合わせを持つカテゴリ1と、持たないカテゴリ2・持つカテゴリ3を置く
async function seedLinkedInquiries(): Promise<void> {
  await insertUser(1);
  await insertUser(2);
  await insertCategory(1, 'Billing');
  await insertCategory(2, '不具合の報告', after(1));
  await insertCategory(3, '機能の要望', after(2));
  await insertMemberInquiry(1, { categoryId: categoryIdOf(1) });
  await insertMemberInquiry(
    2,
    { categoryId: categoryIdOf(1), deletedAt: after(10) },
    2,
  );
  await insertMemberInquiry(3, { categoryId: categoryIdOf(3) });
  await insertMemberInquiry(4, { categoryId: INQUIRY_CATEGORY_OTHER_ID });
  await insertGuestInquiry(1, { categoryId: categoryIdOf(1) });
  await insertGuestInquiry(2, { categoryId: categoryIdOf(3) });
}

beforeEach(async () => {
  await resetInquiryTables();
  await clearIdentityTables();
});

describe('D1InquiryCategoryStore', () => {
  describe('初期データ', () => {
    test('標準カテゴリ「その他」が共用部品の固定IDと名前で1件だけ入っている', async () => {
      const rows = await readCategoryRows();

      expect(rows).toEqual([
        {
          id: INQUIRY_CATEGORY_OTHER_ID,
          name: INQUIRY_CATEGORY_OTHER_NAME,
          systemDefault: true,
          createdAt: SEEDED_OTHER_CREATED_AT,
          updatedAt: SEEDED_OTHER_CREATED_AT,
        },
      ]);
    });
  });

  describe('list・findById', () => {
    test('全カテゴリを標準かどうかと作成日時付きで返す', async () => {
      await insertCategory(1, 'Billing', after(5));

      const categories = await createStore().list();

      expect(categories).toEqual(
        expect.arrayContaining([
          {
            id: INQUIRY_CATEGORY_OTHER_ID,
            name: INQUIRY_CATEGORY_OTHER_NAME,
            systemDefault: true,
            createdAt: SEEDED_OTHER_CREATED_AT,
          },
          {
            id: categoryIdOf(1),
            name: 'Billing',
            systemDefault: false,
            createdAt: after(5),
          },
        ]),
      );
      expect(categories).toHaveLength(2);
    });

    test('IDで1件を返し、無ければundefinedを返す', async () => {
      await insertCategory(1, 'Billing');
      const store = createStore();

      await expect(store.findById(categoryIdOf(1))).resolves.toEqual({
        id: categoryIdOf(1),
        name: 'Billing',
        systemDefault: false,
        createdAt: T0,
      });
      await expect(store.findById(categoryIdOf(9))).resolves.toBeUndefined();
    });
  });

  describe('insert', () => {
    test('カテゴリと監査ログを同じ一括の書き込みで保存する', async () => {
      const recording = createBatchRecordingD1(env.DB);
      const store = new D1InquiryCategoryStore(createDatabase(recording.d1));

      const result = await store.insert(
        { id: categoryIdOf(1), name: 'Billing', at: after(3) },
        createAuditOf(1, categoryIdOf(1)),
      );

      expect(result).toBe('created');
      await expect(createStore().findById(categoryIdOf(1))).resolves.toEqual({
        id: categoryIdOf(1),
        name: 'Billing',
        systemDefault: false,
        createdAt: after(3),
      });
      await expect(readAuditLogs()).resolves.toEqual([
        {
          id: auditLogIdOf(1),
          operatorAdminId: OPERATOR_ADMIN_ID,
          action: INQUIRY_CATEGORY_CREATE_ACTION.name,
          targetKind: 'category',
          detail: {},
          targetIds: [categoryIdOf(1)],
        },
      ]);
      expect(recording.batches).toHaveLength(1);
      expect(recording.statementsOutsideBatches()).toEqual([]);
    });

    test.each([['billing'], ['BILLING'], ['Billing']])(
      '大文字小文字だけが異なる名前%sはname-takenを返し、カテゴリも監査ログも残さない',
      async (name) => {
        await insertCategory(1, 'Billing');

        const result = await createStore().insert(
          { id: categoryIdOf(2), name, at: after(3) },
          createAuditOf(1, categoryIdOf(2)),
        );

        expect(result).toBe('name-taken');
        await expect(
          createStore().findById(categoryIdOf(2)),
        ).resolves.toBeUndefined();
        await expect(readAuditLogs()).resolves.toEqual([]);
      },
    );

    test('標準カテゴリと同じ名前はname-takenを返す', async () => {
      const result = await createStore().insert(
        { id: categoryIdOf(1), name: INQUIRY_CATEGORY_OTHER_NAME, at: T0 },
        createAuditOf(1, categoryIdOf(1)),
      );

      expect(result).toBe('name-taken');
      await expect(readAuditLogs()).resolves.toEqual([]);
    });
  });

  describe('rename', () => {
    test('名前と更新日時を変え、監査ログを同じ一括の書き込みで保存する', async () => {
      await insertCategory(1, 'Billing');
      const recording = createBatchRecordingD1(env.DB);
      const store = new D1InquiryCategoryStore(createDatabase(recording.d1));

      const result = await store.rename(
        categoryIdOf(1),
        '支払い',
        after(7),
        renameAuditOf(1, categoryIdOf(1)),
      );

      expect(result).toBe('renamed');
      const [, renamed] = await readCategoryRows();
      expect(renamed).toMatchObject({
        id: categoryIdOf(1),
        name: '支払い',
        createdAt: T0,
        updatedAt: after(7),
      });
      await expect(readAuditLogs()).resolves.toEqual([
        expect.objectContaining({
          id: auditLogIdOf(1),
          action: INQUIRY_CATEGORY_RENAME_ACTION.name,
          targetIds: [categoryIdOf(1)],
        }),
      ]);
      expect(recording.batches).toHaveLength(1);
      expect(recording.statementsOutsideBatches()).toEqual([]);
    });

    test('自分の名前の大文字小文字だけを変えられる', async () => {
      await insertCategory(1, 'billing');

      const result = await createStore().rename(
        categoryIdOf(1),
        'Billing',
        after(7),
        renameAuditOf(1, categoryIdOf(1)),
      );

      expect(result).toBe('renamed');
      await expect(createStore().findById(categoryIdOf(1))).resolves.toEqual(
        expect.objectContaining({ name: 'Billing' }),
      );
    });

    test('大文字小文字だけが他のカテゴリと異なる名前はname-takenを返し、名前も監査ログも変えない', async () => {
      await insertCategory(1, 'Billing');
      await insertCategory(2, '不具合の報告');

      const result = await createStore().rename(
        categoryIdOf(2),
        'BILLING',
        after(7),
        renameAuditOf(1, categoryIdOf(2)),
      );

      expect(result).toBe('name-taken');
      await expect(createStore().findById(categoryIdOf(2))).resolves.toEqual(
        expect.objectContaining({ name: '不具合の報告' }),
      );
      await expect(readAuditLogs()).resolves.toEqual([]);
    });

    test('存在しないカテゴリはnot-foundを返し、監査ログを残さない', async () => {
      const result = await createStore().rename(
        categoryIdOf(9),
        'Billing',
        after(7),
        renameAuditOf(1, categoryIdOf(9)),
      );

      expect(result).toBe('not-found');
      await expect(readAuditLogs()).resolves.toEqual([]);
    });

    test('標準カテゴリは条件により名前を変えずnot-foundを返し、監査ログを残さない', async () => {
      const result = await createStore().rename(
        INQUIRY_CATEGORY_OTHER_ID,
        'Other',
        after(7),
        renameAuditOf(1, INQUIRY_CATEGORY_OTHER_ID),
      );

      expect(result).toBe('not-found');
      await expect(
        createStore().findById(INQUIRY_CATEGORY_OTHER_ID),
      ).resolves.toEqual(
        expect.objectContaining({ name: INQUIRY_CATEGORY_OTHER_NAME }),
      );
      await expect(readAuditLogs()).resolves.toEqual([]);
    });
  });

  describe('deleteAndReassign', () => {
    test('両テーブルの紐付く問い合わせ(退会済みを含む)を「その他」へ付け替え、カテゴリを消し、監査ログと同じ一括の書き込みで確定させる', async () => {
      await seedLinkedInquiries();
      const recording = createBatchRecordingD1(env.DB);
      const store = new D1InquiryCategoryStore(createDatabase(recording.d1));

      const deletion = await store.deleteAndReassign(
        categoryIdOf(1),
        deleteAuditOf(1, categoryIdOf(1), 3),
      );

      expect(deletion).toEqual({ result: 'deleted', reassigned: 3 });
      await expect(readMemberInquiryCategoryIds()).resolves.toEqual([
        { id: memberInquiryIdOf(1), categoryId: INQUIRY_CATEGORY_OTHER_ID },
        { id: memberInquiryIdOf(2), categoryId: INQUIRY_CATEGORY_OTHER_ID },
        { id: memberInquiryIdOf(3), categoryId: categoryIdOf(3) },
        { id: memberInquiryIdOf(4), categoryId: INQUIRY_CATEGORY_OTHER_ID },
      ]);
      await expect(readGuestInquiryCategoryIds()).resolves.toEqual([
        { id: guestInquiryIdOf(1), categoryId: INQUIRY_CATEGORY_OTHER_ID },
        { id: guestInquiryIdOf(2), categoryId: categoryIdOf(3) },
      ]);
      await expect(
        createStore().findById(categoryIdOf(1)),
      ).resolves.toBeUndefined();
      await expect(readAuditLogs()).resolves.toEqual([
        {
          id: auditLogIdOf(1),
          operatorAdminId: OPERATOR_ADMIN_ID,
          action: INQUIRY_CATEGORY_DELETE_ACTION.name,
          targetKind: 'category',
          detail: { reassignedCount: '3' },
          targetIds: [categoryIdOf(1)],
        },
      ]);
      expect(recording.batches).toHaveLength(1);
      expect(recording.statementsOutsideBatches()).toEqual([]);
    });

    test('紐付く問い合わせが無いカテゴリは付け替え0件で消す', async () => {
      await seedLinkedInquiries();

      const deletion = await createStore().deleteAndReassign(
        categoryIdOf(2),
        deleteAuditOf(1, categoryIdOf(2), 0),
      );

      expect(deletion).toEqual({ result: 'deleted', reassigned: 0 });
      await expect(
        createStore().findById(categoryIdOf(2)),
      ).resolves.toBeUndefined();
      await expect(readAuditLogs()).resolves.toHaveLength(1);
    });

    test('標準カテゴリは条件により消さずnot-foundを返し、付け替えも監査ログも残さない', async () => {
      await seedLinkedInquiries();

      const deletion = await createStore().deleteAndReassign(
        INQUIRY_CATEGORY_OTHER_ID,
        deleteAuditOf(1, INQUIRY_CATEGORY_OTHER_ID, 1),
      );

      expect(deletion).toEqual({ result: 'not-found', reassigned: 0 });
      await expect(
        createStore().findById(INQUIRY_CATEGORY_OTHER_ID),
      ).resolves.toEqual(expect.objectContaining({ systemDefault: true }));
      await expect(readMemberInquiryCategoryIds()).resolves.toContainEqual({
        id: memberInquiryIdOf(4),
        categoryId: INQUIRY_CATEGORY_OTHER_ID,
      });
      await expect(readAuditLogs()).resolves.toEqual([]);
    });

    test('存在しないカテゴリはnot-foundを返し、監査ログを残さない', async () => {
      const deletion = await createStore().deleteAndReassign(
        categoryIdOf(9),
        deleteAuditOf(1, categoryIdOf(9), 0),
      );

      expect(deletion).toEqual({ result: 'not-found', reassigned: 0 });
      await expect(readAuditLogs()).resolves.toEqual([]);
    });

    test('削除の途中で失敗すると、付け替え・削除・監査ログのいずれも残さない', async () => {
      await seedLinkedInquiries();
      await env.DB.exec(
        "CREATE TRIGGER inquiry_categories_delete_failure BEFORE DELETE ON inquiry_categories BEGIN SELECT RAISE(ABORT, 'injected failure'); END",
      );

      try {
        await expect(
          createStore().deleteAndReassign(
            categoryIdOf(1),
            deleteAuditOf(1, categoryIdOf(1), 3),
          ),
        ).rejects.toThrow(/injected failure/u);
      } finally {
        await env.DB.exec('DROP TRIGGER inquiry_categories_delete_failure');
      }

      await expect(readMemberInquiryCategoryIds()).resolves.toEqual([
        { id: memberInquiryIdOf(1), categoryId: categoryIdOf(1) },
        { id: memberInquiryIdOf(2), categoryId: categoryIdOf(1) },
        { id: memberInquiryIdOf(3), categoryId: categoryIdOf(3) },
        { id: memberInquiryIdOf(4), categoryId: INQUIRY_CATEGORY_OTHER_ID },
      ]);
      await expect(readGuestInquiryCategoryIds()).resolves.toEqual([
        { id: guestInquiryIdOf(1), categoryId: categoryIdOf(1) },
        { id: guestInquiryIdOf(2), categoryId: categoryIdOf(3) },
      ]);
      await expect(createStore().findById(categoryIdOf(1))).resolves.toEqual(
        expect.objectContaining({ name: 'Billing' }),
      );
      await expect(readAuditLogs()).resolves.toEqual([]);
    });

    test('削除の後は、消したカテゴリを参照する問い合わせを外部キーの違反で保存できない', async () => {
      await seedLinkedInquiries();
      await createStore().deleteAndReassign(
        categoryIdOf(1),
        deleteAuditOf(1, categoryIdOf(1), 3),
      );

      const guestFailure = await failureMessagesOf(
        insertGuestInquiry(3, { categoryId: categoryIdOf(1) }),
      );
      const memberFailure = await failureMessagesOf(
        insertMemberInquiry(5, { categoryId: categoryIdOf(1) }),
      );

      expect(guestFailure.join('\n')).toMatch(/FOREIGN KEY constraint failed/u);
      expect(memberFailure.join('\n')).toMatch(
        /FOREIGN KEY constraint failed/u,
      );
      await expect(readGuestInquiryCategoryIds()).resolves.toHaveLength(2);
    });
  });

  describe('countLinked・countLinkedByCategory', () => {
    test('カテゴリに紐付く問い合わせの数を両テーブル(退会済みを含む)の和で返す', async () => {
      await seedLinkedInquiries();
      const store = createStore();

      await expect(store.countLinked(categoryIdOf(1))).resolves.toBe(3);
      await expect(store.countLinked(categoryIdOf(2))).resolves.toBe(0);
      await expect(store.countLinked(categoryIdOf(3))).resolves.toBe(2);
      await expect(store.countLinked(INQUIRY_CATEGORY_OTHER_ID)).resolves.toBe(
        1,
      );
    });

    test('カテゴリごとの件数を両テーブルの和で返し、紐付く問い合わせが無いカテゴリを含めない', async () => {
      await seedLinkedInquiries();

      const counts = await createStore().countLinkedByCategory();

      expect(counts).toEqual(
        new Map([
          [categoryIdOf(1), 3],
          [categoryIdOf(3), 2],
          [INQUIRY_CATEGORY_OTHER_ID, 1],
        ]),
      );
    });

    test('数えた件数が削除で付け替わる件数と一致する', async () => {
      await seedLinkedInquiries();
      const store = createStore();
      const linked = await store.countLinked(categoryIdOf(1));

      const deletion = await store.deleteAndReassign(
        categoryIdOf(1),
        deleteAuditOf(1, categoryIdOf(1), linked),
      );

      expect(deletion.reassigned).toBe(linked);
      await expect(store.countLinked(INQUIRY_CATEGORY_OTHER_ID)).resolves.toBe(
        1 + linked,
      );
    });
  });
});
