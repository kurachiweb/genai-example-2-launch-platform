import { env } from 'cloudflare:workers';
import { asc, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';

import {
  HELP_CATEGORY_CREATE_ACTION,
  HELP_CATEGORY_DELETE_ACTION,
  HELP_CATEGORY_RENAME_ACTION,
  HELP_CATEGORY_REORDER_ACTION,
} from '../../../common-lib/admin/audit-actions/help-center.ts';
import {
  HELP_CATEGORY_OTHER_ID,
  HELP_CATEGORY_OTHER_NAME,
} from '../../../common-lib/help/help-category-constants.ts';
import { sortHelpArticles } from '../../../common-lib/help/help-ordering.ts';
import { createDatabase } from '../../../db/client.ts';
import { adminAuditLogTargets } from '../../../db/schema/admin/admin-audit-log-targets.ts';
import { adminAuditLogs } from '../../../db/schema/admin/admin-audit-logs.ts';
import { helpArticles } from '../../../db/schema/help/help-articles.ts';
import { helpCategories } from '../../../db/schema/help/help-categories.ts';
import type { PreparedAuditEntry } from '../../../lib/core/admin/audit-log.ts';
import {
  clearHelpTables,
  db,
  HELP_AUTHOR_ADMIN_ID,
  helpArticleIdOf,
  helpCategoryIdOf,
  insertHelpArticle,
  insertHelpCategory,
  T0,
} from '../../../lib/workers/help/testing/help-fixtures.ts';
import { createBatchRecordingD1 } from '../../../test/support/batch-recording-d1.ts';
import type { HelpCategoryStore } from '../../application/help/ports.ts';
import { D1HelpCategoryStore } from './d1-help-category-store.ts';

const AUDIT_LOG_ID = '01JD0HLOG00000000000000001';

const NOW = new Date('2026-11-05T00:00:00.000Z');

function after(milliseconds: number): Date {
  return new Date(T0.getTime() + milliseconds);
}

function createStore(): HelpCategoryStore {
  return new D1HelpCategoryStore(db);
}

function auditOf(
  action: string,
  targetIds: readonly string[],
  detail: Readonly<Record<string, string>> = {},
): PreparedAuditEntry {
  return {
    id: AUDIT_LOG_ID,
    operatorAdminId: HELP_AUTHOR_ADMIN_ID,
    action,
    targetKind: targetIds.length === 0 ? null : 'category',
    targetIds,
    reason: null,
    detail,
    occurredAt: NOW,
  } as PreparedAuditEntry;
}

async function readAuditLogs() {
  const [logs, targets] = await Promise.all([
    db
      .select({
        id: adminAuditLogs.id,
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

async function readCategoryRows() {
  return db.select().from(helpCategories).orderBy(asc(helpCategories.id));
}

async function readArticleRows() {
  return db.select().from(helpArticles).orderBy(asc(helpArticles.id));
}

async function readOtherCategoryCreatedAt(): Promise<Date> {
  const [row] = await db
    .select({ createdAt: helpCategories.createdAt })
    .from(helpCategories)
    .where(eq(helpCategories.id, HELP_CATEGORY_OTHER_ID));
  if (row === undefined) {
    throw new Error('初期データの標準カテゴリがありません');
  }
  return row.createdAt;
}

beforeEach(async () => {
  await clearHelpTables();
  await db.delete(adminAuditLogTargets);
  await db.delete(adminAuditLogs);
  await db
    .update(helpCategories)
    .set({ name: HELP_CATEGORY_OTHER_NAME, sortOrder: 1, updatedAt: T0 })
    .where(eq(helpCategories.id, HELP_CATEGORY_OTHER_ID));
});

describe('D1HelpCategoryStore', () => {
  describe('list・findById', () => {
    // 標準カテゴリ(並び順1)・カテゴリ2(並び順3)・カテゴリ1(並び順5)の順に並ぶ
    async function seedCategoriesWithArticles(): Promise<void> {
      await insertHelpCategory(1, { name: 'Billing', sortOrder: 5 });
      await insertHelpCategory(2, {
        name: '使い方',
        sortOrder: 3,
        createdAt: after(1),
      });
      await insertHelpArticle(1, { categoryId: helpCategoryIdOf(1) });
      await insertHelpArticle(2, {
        categoryId: helpCategoryIdOf(1),
        status: 'draft',
      });
      await insertHelpArticle(3);
    }

    test('下書き・公開を問わない記事の件数を付け、並び順の順で返す', async () => {
      await seedCategoriesWithArticles();
      const otherCreatedAt = await readOtherCategoryCreatedAt();

      const categories = await createStore().list();

      expect(categories).toEqual([
        {
          id: HELP_CATEGORY_OTHER_ID,
          name: HELP_CATEGORY_OTHER_NAME,
          systemDefault: true,
          sortOrder: 1,
          articleCount: 1,
          createdAt: otherCreatedAt,
        },
        {
          id: helpCategoryIdOf(2),
          name: '使い方',
          systemDefault: false,
          sortOrder: 3,
          articleCount: 0,
          createdAt: after(1),
        },
        {
          id: helpCategoryIdOf(1),
          name: 'Billing',
          systemDefault: false,
          sortOrder: 5,
          articleCount: 2,
          createdAt: T0,
        },
      ]);
    });

    test('IDで1件を記事の件数付きで返し、無ければundefinedを返す', async () => {
      await seedCategoriesWithArticles();
      const store = createStore();

      await expect(store.findById(helpCategoryIdOf(1))).resolves.toEqual({
        id: helpCategoryIdOf(1),
        name: 'Billing',
        systemDefault: false,
        sortOrder: 5,
        articleCount: 2,
        createdAt: T0,
      });
      await expect(store.findById(helpCategoryIdOf(2))).resolves.toEqual(
        expect.objectContaining({ articleCount: 0 }),
      );
      await expect(
        store.findById(helpCategoryIdOf(9)),
      ).resolves.toBeUndefined();
    });
  });

  describe('create', () => {
    test('並び順の末尾に置き、監査ログと同じ一括の書き込みで保存する', async () => {
      await insertHelpCategory(1, { sortOrder: 2 });
      await insertHelpCategory(2, { sortOrder: 7 });
      const recording = createBatchRecordingD1(env.DB);
      const store = new D1HelpCategoryStore(createDatabase(recording.d1));

      const result = await store.create({
        id: helpCategoryIdOf(3),
        name: '機能の使い方',
        now: NOW,
        audit: auditOf(HELP_CATEGORY_CREATE_ACTION.name, [helpCategoryIdOf(3)]),
      });

      expect(result).toBe('created');
      const rows = await readCategoryRows();
      expect(rows.find((row) => row.id === helpCategoryIdOf(3))).toEqual({
        id: helpCategoryIdOf(3),
        name: '機能の使い方',
        systemDefault: false,
        sortOrder: 8,
        createdAt: NOW,
        updatedAt: NOW,
      });
      await expect(readAuditLogs()).resolves.toEqual([
        {
          id: AUDIT_LOG_ID,
          action: HELP_CATEGORY_CREATE_ACTION.name,
          targetKind: 'category',
          detail: {},
          targetIds: [helpCategoryIdOf(3)],
        },
      ]);
      expect(recording.batches).toHaveLength(1);
      expect(recording.statementsOutsideBatches()).toEqual([]);
    });

    test('標準カテゴリだけのときは並び順2に置く', async () => {
      await createStore().create({
        id: helpCategoryIdOf(1),
        name: '機能の使い方',
        now: NOW,
        audit: auditOf(HELP_CATEGORY_CREATE_ACTION.name, [helpCategoryIdOf(1)]),
      });

      await expect(
        createStore().findById(helpCategoryIdOf(1)),
      ).resolves.toEqual(expect.objectContaining({ sortOrder: 2 }));
    });

    test.each([
      ['大文字小文字だけが異なる', 'billing'],
      ['すべて大文字の', 'BILLING'],
      ['同じ', 'Billing'],
      ['標準カテゴリと同じ', HELP_CATEGORY_OTHER_NAME],
    ])(
      '%s名前はname-takenを返し、カテゴリも監査ログも残さない',
      async (_, name) => {
        await insertHelpCategory(1, { name: 'Billing' });
        const before = await readCategoryRows();

        const result = await createStore().create({
          id: helpCategoryIdOf(2),
          name,
          now: NOW,
          audit: auditOf(HELP_CATEGORY_CREATE_ACTION.name, [
            helpCategoryIdOf(2),
          ]),
        });

        expect(result).toBe('name-taken');
        expect(await readCategoryRows()).toEqual(before);
        await expect(readAuditLogs()).resolves.toEqual([]);
      },
    );
  });

  describe('rename', () => {
    test('名前と更新日時を変え、監査ログと同じ一括の書き込みで保存する', async () => {
      await insertHelpCategory(1, { name: 'Billing' });
      const recording = createBatchRecordingD1(env.DB);
      const store = new D1HelpCategoryStore(createDatabase(recording.d1));

      const result = await store.rename({
        id: helpCategoryIdOf(1),
        name: '料金',
        now: NOW,
        audit: auditOf(HELP_CATEGORY_RENAME_ACTION.name, [helpCategoryIdOf(1)]),
      });

      expect(result).toBe('renamed');
      const rows = await readCategoryRows();
      expect(rows.find((row) => row.id === helpCategoryIdOf(1))).toEqual({
        id: helpCategoryIdOf(1),
        name: '料金',
        systemDefault: false,
        sortOrder: 2,
        createdAt: T0,
        updatedAt: NOW,
      });
      await expect(readAuditLogs()).resolves.toEqual([
        {
          id: AUDIT_LOG_ID,
          action: HELP_CATEGORY_RENAME_ACTION.name,
          targetKind: 'category',
          detail: {},
          targetIds: [helpCategoryIdOf(1)],
        },
      ]);
      expect(recording.batches).toHaveLength(1);
      expect(recording.statementsOutsideBatches()).toEqual([]);
    });

    test('自分の名前の大文字小文字だけを変えられる', async () => {
      await insertHelpCategory(1, { name: 'Billing' });

      const result = await createStore().rename({
        id: helpCategoryIdOf(1),
        name: 'BILLING',
        now: NOW,
        audit: auditOf(HELP_CATEGORY_RENAME_ACTION.name, [helpCategoryIdOf(1)]),
      });

      expect(result).toBe('renamed');
      await expect(
        createStore().findById(helpCategoryIdOf(1)),
      ).resolves.toEqual(expect.objectContaining({ name: 'BILLING' }));
    });

    test('大文字小文字だけが他のカテゴリと異なる名前はname-takenを返し、名前も監査ログも変えない', async () => {
      await insertHelpCategory(1, { name: 'Billing' });
      await insertHelpCategory(2, { name: '使い方' });
      const before = await readCategoryRows();

      const result = await createStore().rename({
        id: helpCategoryIdOf(2),
        name: 'billing',
        now: NOW,
        audit: auditOf(HELP_CATEGORY_RENAME_ACTION.name, [helpCategoryIdOf(2)]),
      });

      expect(result).toBe('name-taken');
      expect(await readCategoryRows()).toEqual(before);
      await expect(readAuditLogs()).resolves.toEqual([]);
    });

    test.each([
      ['存在しないカテゴリ', helpCategoryIdOf(9)],
      ['標準カテゴリ', HELP_CATEGORY_OTHER_ID],
    ])('%sは名前を変えずnot-foundを返し、監査ログを残さない', async (_, id) => {
      const before = await readCategoryRows();

      const result = await createStore().rename({
        id,
        name: 'そのほか',
        now: NOW,
        audit: auditOf(HELP_CATEGORY_RENAME_ACTION.name, [id]),
      });

      expect(result).toBe('not-found');
      expect(await readCategoryRows()).toEqual(before);
      await expect(readAuditLogs()).resolves.toEqual([]);
    });
  });

  describe('deleteAndReassign', () => {
    const deleteAudit = (
      id: string,
      reassignedCount: number,
    ): PreparedAuditEntry =>
      auditOf(HELP_CATEGORY_DELETE_ACTION.name, [id], {
        reassignedCount: String(reassignedCount),
      });

    // 標準カテゴリに並び順2・5の記事、カテゴリ1に並び順1(下書き)・3・3(作成日時の新しい方が後)の記事、カテゴリ2に記事1件を置く
    async function seedArticles(): Promise<void> {
      await insertHelpCategory(1);
      await insertHelpCategory(2);
      await insertHelpArticle(1, { sortOrder: 2 });
      await insertHelpArticle(2, { sortOrder: 5, pinned: true });
      await insertHelpArticle(3, {
        categoryId: helpCategoryIdOf(1),
        sortOrder: 3,
        revision: 4,
        updatedAt: after(30),
      });
      await insertHelpArticle(4, {
        categoryId: helpCategoryIdOf(1),
        sortOrder: 1,
        status: 'draft',
        revision: 2,
        updatedAt: after(40),
      });
      await insertHelpArticle(5, {
        categoryId: helpCategoryIdOf(1),
        sortOrder: 3,
        createdAt: after(1),
        updatedAt: after(50),
      });
      await insertHelpArticle(6, {
        categoryId: helpCategoryIdOf(2),
        sortOrder: 1,
      });
    }

    test('下書きを含む記事を標準カテゴリの末尾へ元の相対的な順で付け替え、更新日時と版を変えず、カテゴリを消し、監査ログと同じ一括の書き込みで確定させる', async () => {
      await seedArticles();
      const before = await readArticleRows();
      const recording = createBatchRecordingD1(env.DB);
      const store = new D1HelpCategoryStore(createDatabase(recording.d1));

      const result = await store.deleteAndReassign({
        id: helpCategoryIdOf(1),
        audit: deleteAudit(helpCategoryIdOf(1), 3),
      });

      expect(result).toBe('deleted');
      const reassigned = new Map([
        [helpArticleIdOf(3), 8],
        [helpArticleIdOf(4), 6],
        [helpArticleIdOf(5), 8],
      ]);
      const rows = await readArticleRows();
      expect(rows).toEqual(
        before.map((row) => {
          const sortOrder = reassigned.get(row.id);
          return sortOrder === undefined
            ? row
            : { ...row, categoryId: HELP_CATEGORY_OTHER_ID, sortOrder };
        }),
      );
      expect(
        sortHelpArticles(
          rows.filter((row) => row.categoryId === HELP_CATEGORY_OTHER_ID),
        ).map((row) => row.id),
      ).toEqual([
        helpArticleIdOf(2),
        helpArticleIdOf(1),
        helpArticleIdOf(4),
        helpArticleIdOf(3),
        helpArticleIdOf(5),
      ]);
      await expect(
        createStore().findById(helpCategoryIdOf(1)),
      ).resolves.toBeUndefined();
      await expect(readAuditLogs()).resolves.toEqual([
        {
          id: AUDIT_LOG_ID,
          action: HELP_CATEGORY_DELETE_ACTION.name,
          targetKind: 'category',
          detail: { reassignedCount: '3' },
          targetIds: [helpCategoryIdOf(1)],
        },
      ]);
      expect(recording.batches).toHaveLength(1);
      expect(recording.statementsOutsideBatches()).toEqual([]);
    });

    test('標準カテゴリに記事が無ければ、付け替えた記事の並び順を変えない', async () => {
      await insertHelpCategory(1);
      await insertHelpArticle(1, {
        categoryId: helpCategoryIdOf(1),
        sortOrder: 4,
      });

      await createStore().deleteAndReassign({
        id: helpCategoryIdOf(1),
        audit: deleteAudit(helpCategoryIdOf(1), 1),
      });

      const [row] = await readArticleRows();
      expect(row).toEqual(
        expect.objectContaining({
          categoryId: HELP_CATEGORY_OTHER_ID,
          sortOrder: 4,
          updatedAt: T0,
          revision: 1,
        }),
      );
    });

    test('記事の無いカテゴリを消す', async () => {
      await insertHelpCategory(1);

      const result = await createStore().deleteAndReassign({
        id: helpCategoryIdOf(1),
        audit: deleteAudit(helpCategoryIdOf(1), 0),
      });

      expect(result).toBe('deleted');
      await expect(
        createStore().findById(helpCategoryIdOf(1)),
      ).resolves.toBeUndefined();
    });

    test.each([
      ['存在しないカテゴリ', helpCategoryIdOf(9)],
      ['標準カテゴリ', HELP_CATEGORY_OTHER_ID],
    ])(
      '%sはnot-foundを返し、記事もカテゴリも変えず監査ログを残さない',
      async (_, id) => {
        await seedArticles();
        const beforeArticles = await readArticleRows();
        const beforeCategories = await readCategoryRows();

        const result = await createStore().deleteAndReassign({
          id,
          audit: deleteAudit(id, 0),
        });

        expect(result).toBe('not-found');
        expect(await readArticleRows()).toEqual(beforeArticles);
        expect(await readCategoryRows()).toEqual(beforeCategories);
        await expect(readAuditLogs()).resolves.toEqual([]);
      },
    );

    test('削除の途中で失敗すると、並び順・付け替え・削除・監査ログのいずれも残さない', async () => {
      await seedArticles();
      const beforeArticles = await readArticleRows();
      const beforeCategories = await readCategoryRows();
      await env.DB.exec(
        "CREATE TRIGGER help_categories_delete_failure BEFORE DELETE ON help_categories BEGIN SELECT RAISE(ABORT, 'injected failure'); END",
      );

      try {
        await expect(
          createStore().deleteAndReassign({
            id: helpCategoryIdOf(1),
            audit: deleteAudit(helpCategoryIdOf(1), 3),
          }),
        ).rejects.toThrow(/injected failure/u);
      } finally {
        await env.DB.exec('DROP TRIGGER help_categories_delete_failure');
      }

      expect(await readArticleRows()).toEqual(beforeArticles);
      expect(await readCategoryRows()).toEqual(beforeCategories);
      await expect(readAuditLogs()).resolves.toEqual([]);
    });
  });

  describe('reorder', () => {
    const reorderAudit = (count: number): PreparedAuditEntry =>
      auditOf(HELP_CATEGORY_REORDER_ACTION.name, [], {
        count: String(count),
      });

    beforeEach(async () => {
      await insertHelpCategory(1);
      await insertHelpCategory(2);
    });

    test('標準カテゴリを含む全カテゴリを指定の順に並べ、更新日時を変えず、監査ログと同じ一括の書き込みで確定させる', async () => {
      const before = await readCategoryRows();
      const orderedIds = [
        helpCategoryIdOf(2),
        HELP_CATEGORY_OTHER_ID,
        helpCategoryIdOf(1),
      ];
      const recording = createBatchRecordingD1(env.DB);
      const store = new D1HelpCategoryStore(createDatabase(recording.d1));

      const result = await store.reorder({
        orderedIds,
        audit: reorderAudit(3),
      });

      expect(result).toBe('reordered');
      const sortOrders = new Map(
        orderedIds.map((id, index) => [id, index + 1]),
      );
      expect(await readCategoryRows()).toEqual(
        before.map((row) => ({ ...row, sortOrder: sortOrders.get(row.id) })),
      );
      expect((await createStore().list()).map((row) => row.id)).toEqual(
        orderedIds,
      );
      await expect(readAuditLogs()).resolves.toEqual([
        {
          id: AUDIT_LOG_ID,
          action: HELP_CATEGORY_REORDER_ACTION.name,
          targetKind: null,
          detail: { count: '3' },
          targetIds: [],
        },
      ]);
      expect(recording.batches).toHaveLength(1);
      expect(recording.statementsOutsideBatches()).toEqual([]);
    });

    test.each([
      [
        '並べ替えを始めた後に追加されたカテゴリを含まない',
        [helpCategoryIdOf(2), HELP_CATEGORY_OTHER_ID],
      ],
      [
        '並べ替えを始めた後に削除されたカテゴリを含む',
        [
          helpCategoryIdOf(2),
          HELP_CATEGORY_OTHER_ID,
          helpCategoryIdOf(1),
          helpCategoryIdOf(9),
        ],
      ],
      [
        '同じカテゴリを重ねて含む',
        [helpCategoryIdOf(2), helpCategoryIdOf(2), helpCategoryIdOf(1)],
      ],
    ])(
      '渡したIDが%sとoutdatedを返し、並び順も監査ログも変えない',
      async (_, orderedIds) => {
        const before = await readCategoryRows();

        const result = await createStore().reorder({
          orderedIds,
          audit: reorderAudit(orderedIds.length),
        });

        expect(result).toBe('outdated');
        expect(await readCategoryRows()).toEqual(before);
        await expect(readAuditLogs()).resolves.toEqual([]);
      },
    );
  });
});
