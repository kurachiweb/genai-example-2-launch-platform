import { asc, eq } from 'drizzle-orm';
import { expect } from 'vitest';

import {
  HELP_ARTICLE_CREATE_ACTION,
  HELP_ARTICLE_DELETE_ACTION,
  HELP_ARTICLE_UPDATE_ACTION,
} from '../../../../common-lib/admin/audit-actions/help-center.ts';
import { HELP_CATEGORY_OTHER_ID } from '../../../../common-lib/help/help-category-constants.ts';
import type { Database } from '../../../../db/client.ts';
import { adminAuditLogTargets } from '../../../../db/schema/admin/admin-audit-log-targets.ts';
import { adminAuditLogs } from '../../../../db/schema/admin/admin-audit-logs.ts';
import { helpArticlePreviousHandles } from '../../../../db/schema/help/help-article-previous-handles.ts';
import { helpArticleSearchDocuments } from '../../../../db/schema/help/help-article-search-documents.ts';
import { helpArticles } from '../../../../db/schema/help/help-articles.ts';
import { helpCategories } from '../../../../db/schema/help/help-categories.ts';
import type { PreparedAuditEntry } from '../../../../lib/core/admin/audit-log.ts';
import {
  clearHelpTables,
  db,
  helpArticleIdOf,
  T0,
} from '../../../../lib/workers/help/testing/help-fixtures.ts';
import { createSearchIndexStatements } from '../../../../lib/workers/search/search-index-statements.ts';
import { createSearchTargetRegistry } from '../../../../lib/workers/search/search-target-definition.ts';
import { HELP_ARTICLE_SEARCH_TARGET } from '../../../../lib/workers/search/targets/help-articles.ts';
import type { BatchRecordingD1 } from '../../../../test/support/batch-recording-d1.ts';
import type {
  HelpArticleCreateInput,
  HelpArticleRecord,
  HelpArticleSaveResult,
  HelpArticleUpdateInput,
  HelpArticleWrite,
} from '../../../application/help/ports.ts';
import { planHelpHandleChange } from '../../../domain/help/help-handle-change.ts';
import { D1HelpArticleStore } from '../d1-help-article-store.ts';

export const AUDIT_LOG_ID = '01JD0HLOG00000000000000001';

export const OTHER_AUDIT_LOG_ID = '01JD0HLOG00000000000000002';

export const THIRD_AUDIT_LOG_ID = '01JD0HLOG00000000000000003';

export const NOW = new Date('2026-11-05T00:00:00.000Z');

export const EDITOR_ADMIN_ID = '01JD0ADMN00000000000000002';

const registry = createSearchTargetRegistry([HELP_ARTICLE_SEARCH_TARGET]);

export function createArticleStore(
  database: Database = db,
): D1HelpArticleStore {
  return new D1HelpArticleStore(
    database,
    createSearchIndexStatements(database, registry),
  );
}

// 準備済みの印は記録の実装だけが付けるため、ストアの検査では検証済みと同じ形の値を型の表明で作る
function articleAuditOf(
  action: string,
  articleIndex: number,
  auditLogId: string,
): PreparedAuditEntry {
  const targetIds: readonly string[] = [helpArticleIdOf(articleIndex)];
  return {
    id: auditLogId,
    operatorAdminId: EDITOR_ADMIN_ID,
    action,
    targetKind: 'help-article',
    targetIds,
    reason: null,
    detail: {},
    occurredAt: NOW,
  } as PreparedAuditEntry;
}

export function articleWriteOf(
  overrides: Partial<HelpArticleWrite> = {},
): HelpArticleWrite {
  return {
    handle: 'getting-started',
    title: 'はじめに',
    subtitle: '最初に読む記事',
    bodyMarkdown: '## 見出し\n\n本文',
    categoryId: HELP_CATEGORY_OTHER_ID,
    pinned: false,
    status: 'published',
    ...overrides,
  };
}

export function createInputOf(
  articleIndex: number,
  overrides: Partial<HelpArticleWrite> = {},
  auditLogId = AUDIT_LOG_ID,
): HelpArticleCreateInput {
  return {
    id: helpArticleIdOf(articleIndex),
    write: articleWriteOf(overrides),
    createdByAdminId: EDITOR_ADMIN_ID,
    now: NOW,
    audit: articleAuditOf(
      HELP_ARTICLE_CREATE_ACTION.name,
      articleIndex,
      auditLogId,
    ),
  };
}

// 記事は挿入の補助の既定値(ハンドルarticle<n>・標準カテゴリ・版1)で保存済みとする
export function updateInputOf(
  articleIndex: number,
  overrides: Partial<HelpArticleWrite> = {},
  options: {
    readonly currentHandle?: string;
    readonly expectedRevision?: number;
    readonly categoryChanged?: boolean;
    readonly auditLogId?: string;
  } = {},
): HelpArticleUpdateInput {
  const defaultHandle = `article${String(articleIndex)}`;
  const write = articleWriteOf({ handle: defaultHandle, ...overrides });
  return {
    id: helpArticleIdOf(articleIndex),
    expectedRevision: options.expectedRevision ?? 1,
    write,
    handleChange: planHelpHandleChange(
      options.currentHandle ?? defaultHandle,
      write.handle,
    ),
    categoryChanged: options.categoryChanged ?? false,
    now: NOW,
    audit: articleAuditOf(
      HELP_ARTICLE_UPDATE_ACTION.name,
      articleIndex,
      options.auditLogId ?? AUDIT_LOG_ID,
    ),
  };
}

export function deleteInputOf(articleIndex: number): {
  readonly id: string;
  readonly audit: PreparedAuditEntry;
} {
  return {
    id: helpArticleIdOf(articleIndex),
    audit: articleAuditOf(
      HELP_ARTICLE_DELETE_ACTION.name,
      articleIndex,
      AUDIT_LOG_ID,
    ),
  };
}

export function savedRecordOf(
  result: HelpArticleSaveResult,
): HelpArticleRecord {
  if (result.kind !== 'saved') {
    throw new Error(`記事が保存されませんでした: ${result.kind}`);
  }
  return result.record;
}

export async function readArticles() {
  return db.select().from(helpArticles).orderBy(asc(helpArticles.id));
}

export async function readPreviousHandles() {
  return db
    .select({
      ownerId: helpArticlePreviousHandles.ownerId,
      handle: helpArticlePreviousHandles.handle,
    })
    .from(helpArticlePreviousHandles)
    .orderBy(asc(helpArticlePreviousHandles.ownerId));
}

export async function readIndexDocuments() {
  return db
    .select({
      sourceId: helpArticleSearchDocuments.sourceId,
      keywordStatus: helpArticleSearchDocuments.keywordStatus,
      statusChangedAt: helpArticleSearchDocuments.statusChangedAt,
    })
    .from(helpArticleSearchDocuments)
    .orderBy(asc(helpArticleSearchDocuments.sourceId));
}

// 索引の更新の処理を通さず、抽出の済んだ索引文書の行だけを作る
export async function insertExtractedIndexDocument(
  articleIndex: number,
): Promise<void> {
  await db.insert(helpArticleSearchDocuments).values({
    sourceId: helpArticleIdOf(articleIndex),
    sourceVersion: 1,
    keywordStatus: 'extracted',
    statusChangedAt: T0,
  });
}

export async function readAuditLogs() {
  const [logs, targets] = await Promise.all([
    db
      .select({ id: adminAuditLogs.id, action: adminAuditLogs.action })
      .from(adminAuditLogs)
      .orderBy(asc(adminAuditLogs.id)),
    db
      .select({
        logId: adminAuditLogTargets.logId,
        targetId: adminAuditLogTargets.targetId,
      })
      .from(adminAuditLogTargets),
  ]);
  return logs.map((log) => ({
    ...log,
    targetIds: targets
      .filter((target) => target.logId === log.id)
      .map((target) => target.targetId),
  }));
}

// 失敗した保存・削除でどの行も変わらないことを、前後の比較で確かめる
export async function readHelpArticleState() {
  const [articles, previous, documents, audits] = await Promise.all([
    readArticles(),
    readPreviousHandles(),
    readIndexDocuments(),
    readAuditLogs(),
  ]);
  return { articles, previous, documents, audits };
}

// 書き込みは監査ログを先頭にした1つの一括の書き込みで、その後は保存した記事の読み取りだけであること
export function expectSingleWriteBatch(
  recording: BatchRecordingD1,
  tables: readonly string[],
): void {
  const [writes = [], ...reads] = recording.batches;
  expect(writes[0]).toMatch(/^insert into "admin_audit_logs"/u);
  for (const table of tables) {
    const mentions = new RegExp(`(?:^|[^a-z_])${table}(?:[^a-z_]|$)`, 'u');
    expect(writes.some((query) => mentions.test(query))).toBe(true);
  }
  expect(reads.flat().every((query) => query.startsWith('select'))).toBe(true);
  expect(recording.statementsOutsideBatches()).toEqual([]);
}

export async function resetHelpArticleTables(): Promise<void> {
  await clearHelpTables();
  await db.delete(adminAuditLogTargets);
  await db.delete(adminAuditLogs);
  await db
    .update(helpCategories)
    .set({ sortOrder: 1, updatedAt: T0 })
    .where(eq(helpCategories.id, HELP_CATEGORY_OTHER_ID));
}
