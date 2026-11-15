import { asc, eq } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { beforeEach, describe, expect, test } from 'vitest';

import {
  HELP_ARTICLE_REORDER_ACTION,
  HELP_ARTICLE_UPDATE_ACTION,
  HELP_CATEGORY_REORDER_ACTION,
} from '../../../common-lib/admin/audit-actions/help-center.ts';
import { HELP_CATEGORY_OTHER_ID } from '../../../common-lib/help/help-category-constants.ts';
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
import { buildAuditLogStatements } from '../admin/audit-log-statements.ts';
import {
  helpArticleExistsGuard,
  helpOrderGuard,
  isHelpArticleGuardRejection,
  isHelpOrderGuardRejection,
} from './help-guards.ts';

const AUDIT_LOG_ID = '01JD0HLOG00000000000000001';

function auditOf(
  action: string,
  targetKind: PreparedAuditEntry['targetKind'],
  targetIds: readonly string[],
): PreparedAuditEntry {
  return {
    id: AUDIT_LOG_ID,
    operatorAdminId: HELP_AUTHOR_ADMIN_ID,
    action,
    targetKind,
    targetIds,
    reason: null,
    detail: {},
    occurredAt: T0,
  } as PreparedAuditEntry;
}

const articleAudit = (articleIndex: number): PreparedAuditEntry =>
  auditOf(HELP_ARTICLE_UPDATE_ACTION.name, 'help-article', [
    helpArticleIdOf(articleIndex),
  ]);

const articleOrderAudit = (categoryId: string): PreparedAuditEntry =>
  auditOf(HELP_ARTICLE_REORDER_ACTION.name, 'category', [categoryId]);

const categoryOrderAudit = (): PreparedAuditEntry =>
  auditOf(HELP_CATEGORY_REORDER_ACTION.name, null, []);

async function readArticles() {
  return db.select().from(helpArticles).orderBy(asc(helpArticles.id));
}

async function readCategories() {
  return db.select().from(helpCategories).orderBy(asc(helpCategories.id));
}

async function readAuditLogIds(): Promise<readonly string[]> {
  const rows = await db
    .select({ id: adminAuditLogs.id })
    .from(adminAuditLogs)
    .orderBy(asc(adminAuditLogs.id));
  return rows.map((row) => row.id);
}

async function failureOf(write: Promise<unknown>): Promise<unknown> {
  try {
    await write;
  } catch (error) {
    return error;
  }
  throw new Error('一括の書き込みが取り消されませんでした');
}

// 確認の文の後に、記事の題名の更新と監査ログを同じ一括の書き込みへ並べる
function guardedArticleBatch(
  guard: BatchItem<'sqlite'>,
  articleIndex: number,
): Promise<unknown> {
  return db.batch([
    guard,
    db
      .update(helpArticles)
      .set({ title: '変更後' })
      .where(eq(helpArticles.id, helpArticleIdOf(articleIndex))),
    ...buildAuditLogStatements(db, articleAudit(articleIndex)),
  ]);
}

function guardedOrderBatch(
  guard: BatchItem<'sqlite'>,
  audit: PreparedAuditEntry,
): Promise<unknown> {
  return db.batch([
    guard,
    db
      .update(helpCategories)
      .set({ sortOrder: 99, updatedAt: T0 })
      .where(eq(helpCategories.id, HELP_CATEGORY_OTHER_ID)),
    ...buildAuditLogStatements(db, audit),
  ]);
}

beforeEach(async () => {
  await clearHelpTables();
  await db.delete(adminAuditLogTargets);
  await db.delete(adminAuditLogs);
  await db
    .update(helpCategories)
    .set({ sortOrder: 1 })
    .where(eq(helpCategories.id, HELP_CATEGORY_OTHER_ID));
});

describe('helpArticleExistsGuard', () => {
  test('記事が無ければ、同じ一括の書き込みの他の文と監査ログごと取り消す', async () => {
    await insertHelpArticle(1);
    const before = await readArticles();

    const error = await failureOf(
      guardedArticleBatch(
        helpArticleExistsGuard(db, { id: helpArticleIdOf(2) }),
        2,
      ),
    );

    expect(isHelpArticleGuardRejection(error)).toBe(true);
    expect(isHelpOrderGuardRejection(error)).toBe(false);
    expect(await readArticles()).toEqual(before);
    expect(await readAuditLogIds()).toEqual([]);
  });

  test('版が違えば、記事の更新と監査ログごと取り消す', async () => {
    await insertHelpArticle(1, { revision: 3 });
    const before = await readArticles();

    for (const expectedRevision of [2, 4]) {
      const error = await failureOf(
        guardedArticleBatch(
          helpArticleExistsGuard(db, {
            id: helpArticleIdOf(1),
            expectedRevision,
          }),
          1,
        ),
      );

      expect(isHelpArticleGuardRejection(error)).toBe(true);
    }
    expect(await readArticles()).toEqual(before);
    expect(await readAuditLogIds()).toEqual([]);
  });

  test('記事が存在し版が一致すれば、確認の文は何も書かず、後続の文と監査ログが確定する', async () => {
    await insertHelpArticle(1, { revision: 3 });
    await insertHelpArticle(2, { status: 'draft' });
    const [, untouched] = await readArticles();

    await guardedArticleBatch(
      helpArticleExistsGuard(db, {
        id: helpArticleIdOf(1),
        expectedRevision: 3,
      }),
      1,
    );

    const articles = await readArticles();
    expect(articles).toHaveLength(2);
    expect(articles[0]).toMatchObject({
      id: helpArticleIdOf(1),
      handle: 'article1',
      title: '変更後',
      revision: 3,
    });
    expect(articles[1]).toEqual(untouched);
    expect(await readAuditLogIds()).toEqual([AUDIT_LOG_ID]);
  });

  test('版を渡さなければ、下書きを含む記事の存在だけを確かめる', async () => {
    await insertHelpArticle(1, { status: 'draft', revision: 7 });

    await guardedArticleBatch(
      helpArticleExistsGuard(db, { id: helpArticleIdOf(1) }),
      1,
    );

    expect(await readArticles()).toHaveLength(1);
    expect(await readAuditLogIds()).toEqual([AUDIT_LOG_ID]);
  });
});

describe('helpOrderGuard(カテゴリ)', () => {
  beforeEach(async () => {
    await insertHelpCategory(1);
    await insertHelpCategory(2);
  });

  const allCategoryIds = (): readonly string[] => [
    helpCategoryIdOf(2),
    HELP_CATEGORY_OTHER_ID,
    helpCategoryIdOf(1),
  ];

  test('標準カテゴリを含む全カテゴリの集合と一致すれば、渡した順によらず何も書かず、後続の文と監査ログが確定する', async () => {
    const before = await readCategories();

    await guardedOrderBatch(
      helpOrderGuard(db, { kind: 'categories', orderedIds: allCategoryIds() }),
      categoryOrderAudit(),
    );

    const after = await readCategories();
    expect(after).toEqual(
      before.map((row) =>
        row.id === HELP_CATEGORY_OTHER_ID
          ? { ...row, sortOrder: 99, updatedAt: T0 }
          : row,
      ),
    );
    expect(await readAuditLogIds()).toEqual([AUDIT_LOG_ID]);
  });

  test.each([
    [
      '画面を開いた後に追加されたカテゴリを含まない',
      () => allCategoryIds().slice(1),
    ],
    [
      '画面を開いた後に削除されたカテゴリを含む',
      () => [...allCategoryIds(), helpCategoryIdOf(9)],
    ],
    [
      '同じカテゴリを重ねて含む',
      () => [...allCategoryIds().slice(1), helpCategoryIdOf(1)],
    ],
    ['空である', () => []],
    [
      '同じ件数で、1件を存在しないカテゴリに入れ替えたもの',
      () => [helpCategoryIdOf(2), HELP_CATEGORY_OTHER_ID, helpCategoryIdOf(9)],
    ],
  ])('渡したIDが%sと、並べ替えと監査ログごと取り消す', async (_, ids) => {
    const before = await readCategories();

    const error = await failureOf(
      guardedOrderBatch(
        helpOrderGuard(db, { kind: 'categories', orderedIds: ids() }),
        categoryOrderAudit(),
      ),
    );

    expect(isHelpOrderGuardRejection(error)).toBe(true);
    expect(isHelpArticleGuardRejection(error)).toBe(false);
    expect(await readCategories()).toEqual(before);
    expect(await readAuditLogIds()).toEqual([]);
  });
});

describe('helpOrderGuard(記事)', () => {
  beforeEach(async () => {
    await insertHelpCategory(1);
    await insertHelpArticle(1, { categoryId: helpCategoryIdOf(1) });
    await insertHelpArticle(2, {
      categoryId: helpCategoryIdOf(1),
      status: 'draft',
    });
    await insertHelpArticle(3, {
      categoryId: helpCategoryIdOf(1),
      pinned: true,
    });
    await insertHelpArticle(4);
  });

  const categoryArticleIds = (): readonly string[] => [
    helpArticleIdOf(3),
    helpArticleIdOf(2),
    helpArticleIdOf(1),
  ];

  test('下書きを含むカテゴリの全記事の集合と一致すれば、何も書かず、後続の文と監査ログが確定する', async () => {
    const articlesBefore = await readArticles();

    await guardedOrderBatch(
      helpOrderGuard(db, {
        kind: 'articles',
        categoryId: helpCategoryIdOf(1),
        orderedIds: categoryArticleIds(),
      }),
      articleOrderAudit(helpCategoryIdOf(1)),
    );

    expect(await readArticles()).toEqual(articlesBefore);
    const [other] = await db
      .select({ sortOrder: helpCategories.sortOrder })
      .from(helpCategories)
      .where(eq(helpCategories.id, HELP_CATEGORY_OTHER_ID));
    expect(other?.sortOrder).toBe(99);
    expect(await readAuditLogIds()).toEqual([AUDIT_LOG_ID]);
  });

  test('記事の無いカテゴリは、空の配列と一致する', async () => {
    await insertHelpCategory(2);

    await guardedOrderBatch(
      helpOrderGuard(db, {
        kind: 'articles',
        categoryId: helpCategoryIdOf(2),
        orderedIds: [],
      }),
      articleOrderAudit(helpCategoryIdOf(2)),
    );

    expect(await readAuditLogIds()).toEqual([AUDIT_LOG_ID]);
  });

  test.each([
    [
      '並べ替えの最中に追加された記事',
      async () => {
        await insertHelpArticle(5, { categoryId: helpCategoryIdOf(1) });
      },
    ],
    [
      '並べ替えの最中に削除された記事',
      async () => {
        await db
          .delete(helpArticles)
          .where(eq(helpArticles.id, helpArticleIdOf(2)));
      },
    ],
    [
      '並べ替えの最中に他のカテゴリへ移動した記事',
      async () => {
        await db
          .update(helpArticles)
          .set({ categoryId: HELP_CATEGORY_OTHER_ID })
          .where(eq(helpArticles.id, helpArticleIdOf(1)));
      },
    ],
    [
      '並べ替えの最中に他のカテゴリから移動してきた記事',
      async () => {
        await db
          .update(helpArticles)
          .set({ categoryId: helpCategoryIdOf(1) })
          .where(eq(helpArticles.id, helpArticleIdOf(4)));
      },
    ],
    [
      '並べ替えの最中に1件が他のカテゴリへ移り、別の1件が移ってきた件数の変わらない記事',
      async () => {
        await db.batch([
          db
            .update(helpArticles)
            .set({ categoryId: HELP_CATEGORY_OTHER_ID })
            .where(eq(helpArticles.id, helpArticleIdOf(1))),
          db
            .update(helpArticles)
            .set({ categoryId: helpCategoryIdOf(1) })
            .where(eq(helpArticles.id, helpArticleIdOf(4))),
        ]);
      },
    ],
  ])('%sで集合が違うと、並べ替えと監査ログごと取り消す', async (_, change) => {
    await change();
    const articlesBefore = await readArticles();
    const categoriesBefore = await readCategories();

    const error = await failureOf(
      guardedOrderBatch(
        helpOrderGuard(db, {
          kind: 'articles',
          categoryId: helpCategoryIdOf(1),
          orderedIds: categoryArticleIds(),
        }),
        articleOrderAudit(helpCategoryIdOf(1)),
      ),
    );

    expect(isHelpOrderGuardRejection(error)).toBe(true);
    expect(await readArticles()).toEqual(articlesBefore);
    expect(await readCategories()).toEqual(categoriesBefore);
    expect(await readAuditLogIds()).toEqual([]);
  });
});

describe('確認の文の取り消しの判定', () => {
  test('確認の文以外の制約の違反は、どちらの確認の文の取り消しとも判定しない', async () => {
    await insertHelpArticle(1);

    const error = await failureOf(
      db.batch([
        db.insert(helpArticles).values({
          id: helpArticleIdOf(2),
          handle: 'ARTICLE1',
          title: 't',
          subtitle: 's',
          bodyMarkdown: 'b',
          categoryId: HELP_CATEGORY_OTHER_ID,
          status: 'published',
          sortOrder: 1,
          createdByAdminId: HELP_AUTHOR_ADMIN_ID,
          createdAt: T0,
          updatedAt: T0,
        }),
      ]),
    );

    expect(isHelpArticleGuardRejection(error)).toBe(false);
    expect(isHelpOrderGuardRejection(error)).toBe(false);
    expect(isHelpArticleGuardRejection(new Error('other'))).toBe(false);
    expect(isHelpOrderGuardRejection(undefined)).toBe(false);
  });
});
