import { env } from 'cloudflare:workers';
import { asc, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';

import {
  REPORT_CATEGORY_CREATE_ACTION,
  REPORT_CATEGORY_DELETE_ACTION,
  REPORT_CATEGORY_RENAME_ACTION,
} from '../../../common-lib/admin/audit-actions/content-reporting.ts';
import {
  REPORT_CATEGORY_INFRINGEMENT_ID,
  REPORT_CATEGORY_INFRINGEMENT_NAME,
  REPORT_CATEGORY_OTHER_ID,
  REPORT_CATEGORY_OTHER_NAME,
} from '../../../common-lib/reporting/report-rules.ts';
import { createDatabase } from '../../../db/client.ts';
import { adminAuditLogTargets } from '../../../db/schema/admin/admin-audit-log-targets.ts';
import { adminAuditLogs } from '../../../db/schema/admin/admin-audit-logs.ts';
import { reportCases } from '../../../db/schema/reporting/report-cases.ts';
import { reportCategories } from '../../../db/schema/reporting/report-categories.ts';
import { reports } from '../../../db/schema/reporting/reports.ts';
import type { PreparedAuditEntry } from '../../../lib/core/admin/audit-log.ts';
import { createBatchRecordingD1 } from '../../../test/support/batch-recording-d1.ts';
import type { ReportCategoryStore } from '../../application/reporting/ports.ts';
import { D1ReportCategoryStore } from './d1-report-category-store.ts';

const T0 = new Date('2026-11-22T00:00:00.000Z');

const SEEDED_CREATED_AT = new Date(1_733_019_303_936);

const OPERATOR_ADMIN_ID = '01JE0ADMN00000000000000001';

const db = createDatabase(env.DB);

const after = (milliseconds: number): Date =>
  new Date(T0.getTime() + milliseconds);

const categoryIdOf = (index: number): string =>
  `01JE0RCTG${String(index).padStart(17, '0')}`;

const caseIdOf = (index: number): string =>
  `01JE0RCSE${String(index).padStart(17, '0')}`;

const reportIdOf = (index: number): string =>
  `01JE0RPRT${String(index).padStart(17, '0')}`;

const auditLogIdOf = (index: number): string =>
  `01JE0A10G${String(index).padStart(17, '0')}`;

function createStore(): ReportCategoryStore {
  return new D1ReportCategoryStore(db);
}

// 準備済みの印は記録の実装だけが付けるため、ストアの検査では検証済みと同じ形の値を型の表明で作る
function auditOf(
  index: number,
  action: string,
  categoryId: string,
  detail: Readonly<Record<string, string>> = {},
): PreparedAuditEntry {
  return {
    id: auditLogIdOf(index),
    operatorAdminId: OPERATOR_ADMIN_ID,
    action,
    targetKind: 'category',
    targetIds: [categoryId] as readonly string[],
    reason: null,
    detail,
    occurredAt: T0,
  } as PreparedAuditEntry;
}

const createAuditOf = (index: number, categoryId: string): PreparedAuditEntry =>
  auditOf(index, REPORT_CATEGORY_CREATE_ACTION.name, categoryId);

const renameAuditOf = (index: number, categoryId: string): PreparedAuditEntry =>
  auditOf(index, REPORT_CATEGORY_RENAME_ACTION.name, categoryId);

const deleteAuditOf = (
  index: number,
  categoryId: string,
  reassignedCount: number,
): PreparedAuditEntry =>
  auditOf(index, REPORT_CATEGORY_DELETE_ACTION.name, categoryId, {
    reassignedCount: String(reassignedCount),
  });

// 標準カテゴリはマイグレーションの初期データで常に入るため残し、それ以外の行と監査ログを消す
async function resetReportingTables(): Promise<void> {
  await db.batch([
    db.delete(reports),
    db.delete(reportCases),
    db
      .delete(reportCategories)
      .where(eq(reportCategories.systemDefault, false)),
    db.delete(adminAuditLogTargets),
    db.delete(adminAuditLogs),
  ]);
}

async function insertCategory(
  index: number,
  name: string,
  createdAt: Date = T0,
): Promise<void> {
  await db.insert(reportCategories).values({
    id: categoryIdOf(index),
    name,
    createdAt,
    updatedAt: createdAt,
  });
}

async function insertCase(index: number): Promise<void> {
  await db.insert(reportCases).values({
    id: caseIdOf(index),
    targetKind: 'product',
    targetId: `01JE0PRDT${String(index).padStart(17, '0')}`,
    statusChangedAt: T0,
    lastReportedAt: T0,
    createdAt: T0,
    updatedAt: T0,
  });
}

async function insertReport(
  index: number,
  columns: {
    readonly categoryId: string;
    readonly categoryName: string;
    readonly deletedAt?: Date;
  },
): Promise<void> {
  await db.insert(reports).values({
    id: reportIdOf(index),
    caseId: caseIdOf(1),
    categoryId: columns.categoryId,
    categoryName: columns.categoryName,
    reason: `通報の理由${String(index)}`,
    reportedAt: T0,
    createdAt: T0,
    updatedAt: T0,
    deletedAt: columns.deletedAt ?? null,
  });
}

async function readCategoryRows() {
  return db.select().from(reportCategories).orderBy(asc(reportCategories.id));
}

async function readReportRows() {
  return db
    .select({
      id: reports.id,
      categoryId: reports.categoryId,
      categoryName: reports.categoryName,
      updatedAt: reports.updatedAt,
    })
    .from(reports)
    .orderBy(asc(reports.id));
}

async function readAuditLogs() {
  const [logs, targets] = await Promise.all([
    db
      .select({
        id: adminAuditLogs.id,
        operatorAdminId: adminAuditLogs.operatorAdminId,
        action: adminAuditLogs.action,
        targetKind: adminAuditLogs.targetKind,
        detail: adminAuditLogs.detail,
      })
      .from(adminAuditLogs)
      .orderBy(asc(adminAuditLogs.id)),
    db
      .select({
        logId: adminAuditLogTargets.logId,
        targetId: adminAuditLogTargets.targetId,
      })
      .from(adminAuditLogTargets)
      .orderBy(asc(adminAuditLogTargets.id)),
  ]);
  return logs.map((log) => ({
    ...log,
    targetIds: targets
      .filter((target) => target.logId === log.id)
      .map((target) => target.targetId),
  }));
}

// Drizzleの失敗はD1のエラーをcauseに持つため、原因をたどって文言を集める
async function failureMessagesOf(write: Promise<unknown>): Promise<string> {
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
  return messages.join('\n');
}

// カテゴリ1に論理削除を含む3件、カテゴリ2に0件、カテゴリ3に1件、「その他」に1件の通報を置く
async function seedLinkedReports(): Promise<void> {
  await insertCategory(1, 'スパム', after(1));
  await insertCategory(2, '誹謗中傷', after(2));
  await insertCategory(3, '不適切な画像', after(3));
  await insertCase(1);
  await insertReport(1, {
    categoryId: categoryIdOf(1),
    categoryName: 'スパム',
  });
  await insertReport(2, {
    categoryId: categoryIdOf(1),
    categoryName: '迷惑行為',
  });
  await insertReport(3, {
    categoryId: categoryIdOf(1),
    categoryName: 'スパム',
    deletedAt: after(10),
  });
  await insertReport(4, {
    categoryId: categoryIdOf(3),
    categoryName: '不適切な画像',
  });
  await insertReport(5, {
    categoryId: REPORT_CATEGORY_OTHER_ID,
    categoryName: REPORT_CATEGORY_OTHER_NAME,
  });
}

const SEEDED_REPORT_CATEGORY_IDS = [
  categoryIdOf(1),
  categoryIdOf(1),
  categoryIdOf(1),
  categoryIdOf(3),
  REPORT_CATEGORY_OTHER_ID,
];

// seedLinkedReportsの通報のカテゴリと更新日時が置いたときのままかを確かめる
async function reportsUnchanged(): Promise<boolean> {
  const rows = await readReportRows();
  return (
    rows.length === SEEDED_REPORT_CATEGORY_IDS.length &&
    rows.every(
      (row, index) =>
        row.categoryId === SEEDED_REPORT_CATEGORY_IDS[index] &&
        row.updatedAt.getTime() === T0.getTime(),
    )
  );
}

beforeEach(async () => {
  await resetReportingTables();
});

describe('D1ReportCategoryStore', () => {
  describe('list・find・countReports', () => {
    test('標準カテゴリを含む全カテゴリを、紐付く通報の件数(論理削除を含む)とともに作成日時の順で返す', async () => {
      await seedLinkedReports();

      const categories = await createStore().list();

      expect(categories).toEqual([
        {
          id: REPORT_CATEGORY_INFRINGEMENT_ID,
          name: REPORT_CATEGORY_INFRINGEMENT_NAME,
          systemDefault: true,
          createdAt: SEEDED_CREATED_AT,
          reportCount: 0,
        },
        {
          id: REPORT_CATEGORY_OTHER_ID,
          name: REPORT_CATEGORY_OTHER_NAME,
          systemDefault: true,
          createdAt: SEEDED_CREATED_AT,
          reportCount: 1,
        },
        {
          id: categoryIdOf(1),
          name: 'スパム',
          systemDefault: false,
          createdAt: after(1),
          reportCount: 3,
        },
        {
          id: categoryIdOf(2),
          name: '誹謗中傷',
          systemDefault: false,
          createdAt: after(2),
          reportCount: 0,
        },
        {
          id: categoryIdOf(3),
          name: '不適切な画像',
          systemDefault: false,
          createdAt: after(3),
          reportCount: 1,
        },
      ]);
    });

    test('IDで1件を返し、無ければundefinedを返す', async () => {
      await insertCategory(1, 'スパム');
      const store = createStore();

      await expect(store.find(categoryIdOf(1))).resolves.toEqual({
        id: categoryIdOf(1),
        name: 'スパム',
        systemDefault: false,
        createdAt: T0,
      });
      await expect(store.find(REPORT_CATEGORY_OTHER_ID)).resolves.toEqual({
        id: REPORT_CATEGORY_OTHER_ID,
        name: REPORT_CATEGORY_OTHER_NAME,
        systemDefault: true,
        createdAt: SEEDED_CREATED_AT,
      });
      await expect(store.find(categoryIdOf(9))).resolves.toBeUndefined();
    });

    test('カテゴリに紐付く通報の件数を論理削除を含めて数える', async () => {
      await seedLinkedReports();
      const store = createStore();

      await expect(store.countReports(categoryIdOf(1))).resolves.toBe(3);
      await expect(store.countReports(categoryIdOf(2))).resolves.toBe(0);
      await expect(store.countReports(REPORT_CATEGORY_OTHER_ID)).resolves.toBe(
        1,
      );
      await expect(store.countReports(categoryIdOf(9))).resolves.toBe(0);
    });
  });

  describe('insert', () => {
    test('カテゴリと監査ログを同じ一括の書き込みで保存する', async () => {
      const recording = createBatchRecordingD1(env.DB);
      const store = new D1ReportCategoryStore(createDatabase(recording.d1));

      const result = await store.insert(
        { id: categoryIdOf(1), name: 'スパム', at: after(3) },
        createAuditOf(1, categoryIdOf(1)),
      );

      expect(result).toBe('created');
      await expect(createStore().find(categoryIdOf(1))).resolves.toEqual({
        id: categoryIdOf(1),
        name: 'スパム',
        systemDefault: false,
        createdAt: after(3),
      });
      await expect(readAuditLogs()).resolves.toEqual([
        {
          id: auditLogIdOf(1),
          operatorAdminId: OPERATOR_ADMIN_ID,
          action: REPORT_CATEGORY_CREATE_ACTION.name,
          targetKind: 'category',
          detail: {},
          targetIds: [categoryIdOf(1)],
        },
      ]);
      expect(recording.batches).toHaveLength(1);
      expect(recording.statementsOutsideBatches()).toEqual([]);
    });

    test('前後の空白を除いた名前で保存する', async () => {
      const result = await createStore().insert(
        { id: categoryIdOf(1), name: '　 スパム \t', at: T0 },
        createAuditOf(1, categoryIdOf(1)),
      );

      expect(result).toBe('created');
      await expect(createStore().find(categoryIdOf(1))).resolves.toEqual(
        expect.objectContaining({ name: 'スパム' }),
      );
    });

    test.each([['spam'], ['SPAM'], [' Spam '], ['　spam　']])(
      '前後の空白と大文字小文字だけが異なる名前%jはname-takenを返し、カテゴリも監査ログも残さない',
      async (name) => {
        await insertCategory(1, 'Spam');

        const result = await createStore().insert(
          { id: categoryIdOf(2), name, at: after(3) },
          createAuditOf(1, categoryIdOf(2)),
        );

        expect(result).toBe('name-taken');
        await expect(
          createStore().find(categoryIdOf(2)),
        ).resolves.toBeUndefined();
        await expect(readAuditLogs()).resolves.toEqual([]);
      },
    );

    test.each([
      [REPORT_CATEGORY_INFRINGEMENT_NAME],
      [` ${REPORT_CATEGORY_OTHER_NAME} `],
    ])('標準カテゴリと同じ名前%jはname-takenを返す', async (name) => {
      const result = await createStore().insert(
        { id: categoryIdOf(1), name, at: T0 },
        createAuditOf(1, categoryIdOf(1)),
      );

      expect(result).toBe('name-taken');
      await expect(readAuditLogs()).resolves.toEqual([]);
    });
  });

  describe('rename', () => {
    test('名前と更新日時を変え、監査ログを同じ一括の書き込みで保存する', async () => {
      await insertCategory(1, 'スパム');
      const recording = createBatchRecordingD1(env.DB);
      const store = new D1ReportCategoryStore(createDatabase(recording.d1));

      const result = await store.rename(
        categoryIdOf(1),
        ' 迷惑行為 ',
        after(7),
        renameAuditOf(1, categoryIdOf(1)),
      );

      expect(result).toBe('renamed');
      const renamed = (await readCategoryRows()).find(
        (row) => row.id === categoryIdOf(1),
      );
      expect(renamed).toMatchObject({
        name: '迷惑行為',
        createdAt: T0,
        updatedAt: after(7),
      });
      await expect(readAuditLogs()).resolves.toEqual([
        expect.objectContaining({
          id: auditLogIdOf(1),
          action: REPORT_CATEGORY_RENAME_ACTION.name,
          targetIds: [categoryIdOf(1)],
        }),
      ]);
      expect(recording.batches).toHaveLength(1);
      expect(recording.statementsOutsideBatches()).toEqual([]);
    });

    test('自分の名前の大文字小文字だけを変えられる', async () => {
      await insertCategory(1, 'spam');

      const result = await createStore().rename(
        categoryIdOf(1),
        'Spam',
        after(7),
        renameAuditOf(1, categoryIdOf(1)),
      );

      expect(result).toBe('renamed');
      await expect(createStore().find(categoryIdOf(1))).resolves.toEqual(
        expect.objectContaining({ name: 'Spam' }),
      );
    });

    test.each([['SPAM'], [' spam ']])(
      '前後の空白と大文字小文字だけが他のカテゴリと異なる名前%jはname-takenを返し、名前も監査ログも変えない',
      async (name) => {
        await insertCategory(1, 'Spam');
        await insertCategory(2, '誹謗中傷');

        const result = await createStore().rename(
          categoryIdOf(2),
          name,
          after(7),
          renameAuditOf(1, categoryIdOf(2)),
        );

        expect(result).toBe('name-taken');
        await expect(createStore().find(categoryIdOf(2))).resolves.toEqual(
          expect.objectContaining({ name: '誹謗中傷' }),
        );
        await expect(readAuditLogs()).resolves.toEqual([]);
      },
    );

    test('存在しないカテゴリはnot-foundを返し、監査ログを残さない', async () => {
      const result = await createStore().rename(
        categoryIdOf(9),
        'スパム',
        after(7),
        renameAuditOf(1, categoryIdOf(9)),
      );

      expect(result).toBe('not-found');
      await expect(readAuditLogs()).resolves.toEqual([]);
    });

    test.each([
      [REPORT_CATEGORY_INFRINGEMENT_ID, REPORT_CATEGORY_INFRINGEMENT_NAME],
      [REPORT_CATEGORY_OTHER_ID, REPORT_CATEGORY_OTHER_NAME],
    ])(
      '標準カテゴリ%sは条件により名前を変えずnot-foundを返し、監査ログを残さない',
      async (id, name) => {
        const result = await createStore().rename(
          id,
          'Other',
          after(7),
          renameAuditOf(1, id),
        );

        expect(result).toBe('not-found');
        await expect(createStore().find(id)).resolves.toEqual(
          expect.objectContaining({ name, systemDefault: true }),
        );
        await expect(readAuditLogs()).resolves.toEqual([]);
      },
    );
  });

  describe('deleteAndReassign', () => {
    test('紐付く通報(論理削除を含む)を「その他」へ付け替えてカテゴリを消し、監査ログと同じ一括の書き込みで確定させ、受付時点のカテゴリ名を変えない', async () => {
      await seedLinkedReports();
      const recording = createBatchRecordingD1(env.DB);
      const store = new D1ReportCategoryStore(createDatabase(recording.d1));

      const result = await store.deleteAndReassign(
        categoryIdOf(1),
        after(20),
        deleteAuditOf(1, categoryIdOf(1), 3),
      );

      expect(result).toBe('deleted');
      await expect(readReportRows()).resolves.toEqual([
        {
          id: reportIdOf(1),
          categoryId: REPORT_CATEGORY_OTHER_ID,
          categoryName: 'スパム',
          updatedAt: after(20),
        },
        {
          id: reportIdOf(2),
          categoryId: REPORT_CATEGORY_OTHER_ID,
          categoryName: '迷惑行為',
          updatedAt: after(20),
        },
        {
          id: reportIdOf(3),
          categoryId: REPORT_CATEGORY_OTHER_ID,
          categoryName: 'スパム',
          updatedAt: after(20),
        },
        {
          id: reportIdOf(4),
          categoryId: categoryIdOf(3),
          categoryName: '不適切な画像',
          updatedAt: T0,
        },
        {
          id: reportIdOf(5),
          categoryId: REPORT_CATEGORY_OTHER_ID,
          categoryName: REPORT_CATEGORY_OTHER_NAME,
          updatedAt: T0,
        },
      ]);
      await expect(
        createStore().find(categoryIdOf(1)),
      ).resolves.toBeUndefined();
      await expect(readAuditLogs()).resolves.toEqual([
        {
          id: auditLogIdOf(1),
          operatorAdminId: OPERATOR_ADMIN_ID,
          action: REPORT_CATEGORY_DELETE_ACTION.name,
          targetKind: 'category',
          detail: { reassignedCount: '3' },
          targetIds: [categoryIdOf(1)],
        },
      ]);
      expect(recording.batches).toHaveLength(1);
      expect(recording.statementsOutsideBatches()).toEqual([]);
    });

    test('数えた件数が削除で付け替わる件数と一致する', async () => {
      await seedLinkedReports();
      const store = createStore();
      const linked = await store.countReports(categoryIdOf(1));

      await store.deleteAndReassign(
        categoryIdOf(1),
        after(20),
        deleteAuditOf(1, categoryIdOf(1), linked),
      );

      await expect(store.countReports(REPORT_CATEGORY_OTHER_ID)).resolves.toBe(
        1 + linked,
      );
    });

    test('紐付く通報が無いカテゴリは付け替えずに消す', async () => {
      await seedLinkedReports();

      const result = await createStore().deleteAndReassign(
        categoryIdOf(2),
        after(20),
        deleteAuditOf(1, categoryIdOf(2), 0),
      );

      expect(result).toBe('deleted');
      await expect(
        createStore().find(categoryIdOf(2)),
      ).resolves.toBeUndefined();
      await expect(reportsUnchanged()).resolves.toBe(true);
      await expect(readAuditLogs()).resolves.toHaveLength(1);
    });

    test.each([[REPORT_CATEGORY_INFRINGEMENT_ID], [REPORT_CATEGORY_OTHER_ID]])(
      '標準カテゴリ%sは条件により消さずnot-foundを返し、付け替えも監査ログも残さない',
      async (id) => {
        await seedLinkedReports();

        const result = await createStore().deleteAndReassign(
          id,
          after(20),
          deleteAuditOf(1, id, 1),
        );

        expect(result).toBe('not-found');
        await expect(createStore().find(id)).resolves.toEqual(
          expect.objectContaining({ systemDefault: true }),
        );
        await expect(reportsUnchanged()).resolves.toBe(true);
        await expect(readAuditLogs()).resolves.toEqual([]);
      },
    );

    test('存在しないカテゴリはnot-foundを返し、監査ログを残さない', async () => {
      const result = await createStore().deleteAndReassign(
        categoryIdOf(9),
        after(20),
        deleteAuditOf(1, categoryIdOf(9), 0),
      );

      expect(result).toBe('not-found');
      await expect(readAuditLogs()).resolves.toEqual([]);
    });

    test('削除の途中で失敗すると、付け替え・削除・監査ログのいずれも残さない', async () => {
      await seedLinkedReports();
      await env.DB.exec(
        "CREATE TRIGGER report_categories_delete_failure BEFORE DELETE ON report_categories BEGIN SELECT RAISE(ABORT, 'injected failure'); END",
      );

      try {
        await expect(
          createStore().deleteAndReassign(
            categoryIdOf(1),
            after(20),
            deleteAuditOf(1, categoryIdOf(1), 3),
          ),
        ).rejects.toThrow(/injected failure/u);
      } finally {
        await env.DB.exec('DROP TRIGGER report_categories_delete_failure');
      }

      await expect(reportsUnchanged()).resolves.toBe(true);
      await expect(createStore().find(categoryIdOf(1))).resolves.toEqual(
        expect.objectContaining({ name: 'スパム' }),
      );
      await expect(readAuditLogs()).resolves.toEqual([]);
    });

    test('削除の後は、消したカテゴリを参照する通報を外部キーの違反で保存できない', async () => {
      await seedLinkedReports();
      await createStore().deleteAndReassign(
        categoryIdOf(1),
        after(20),
        deleteAuditOf(1, categoryIdOf(1), 3),
      );

      const failure = await failureMessagesOf(
        insertReport(6, {
          categoryId: categoryIdOf(1),
          categoryName: 'スパム',
        }),
      );

      expect(failure).toMatch(/FOREIGN KEY constraint failed/u);
      await expect(readReportRows()).resolves.toHaveLength(5);
    });
  });
});
