import { and, asc, eq, isNull, ne, sql, type SQL } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { inject, injectable } from 'inversify';
import { ulid } from 'ulid';

import type { Database } from '../../../db/client.ts';
import { helpArticlePreviousHandles } from '../../../db/schema/help/help-article-previous-handles.ts';
import { helpArticles } from '../../../db/schema/help/help-articles.ts';
import { helpCategories } from '../../../db/schema/help/help-categories.ts';
import type { PreparedAuditEntry } from '../../../lib/core/admin/audit-log.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import { SEARCH_TYPES } from '../../../lib/core/search/identifiers.ts';
import {
  handleOccupiedCondition,
  isHandleOccupied,
} from '../../../lib/workers/handles/handle-queries.ts';
import {
  previousHandleDelete,
  previousHandleRelease,
  previousHandleUpsert,
} from '../../../lib/workers/handles/previous-handle-statements.ts';
import { HELP_ARTICLE_HANDLE_NAMESPACE } from '../../../lib/workers/help/help-article-handle-namespace.ts';
import type { SearchIndexStatements } from '../../../lib/workers/search/search-index-statements.ts';
import { HELP_ARTICLE_SEARCH_TARGET } from '../../../lib/workers/search/targets/help-articles.ts';
import type {
  HelpArticleCreateInput,
  HelpArticleListRecord,
  HelpArticleRecord,
  HelpArticleSaveResult,
  HelpArticleStore,
  HelpArticleUpdateInput,
  HelpArticleWrite,
  HelpReorderResult,
} from '../../application/help/ports.ts';
import {
  buildAuditLogStatements,
  isAuditGuardRejection,
} from '../admin/audit-log-statements.ts';
import {
  helpArticleExistsGuard,
  helpOrderGuard,
  isHelpArticleGuardRejection,
  isHelpOrderGuardRejection,
} from './help-guards.ts';
import { keepUpdatedAt } from './keep-updated-at.ts';

type HelpArticleSaveRejection = Exclude<
  HelpArticleSaveResult,
  { readonly kind: 'saved' }
>;

// 保存の取り消しが起こす違反だけを分類の対象にする。取り消しは、更新の存在と版の確認の文(handle)と、カテゴリの存在・使用中の判定(category_id)のNOT NULL制約か、現在のハンドル・旧ハンドルの文字列の一意制約で起こる。旧ハンドルの保有者の一意制約は置き換えの文のON CONFLICTが吸収する。
// D1は`D1_ERROR: NOT NULL constraint failed: help_articles.category_id: SQLITE_CONSTRAINT (...)`を投げ、causeにSQLiteのエラーを持つ
const SAVE_ABORT_VIOLATION_PATTERN =
  /(?:NOT NULL constraint failed: help_articles\.(?:handle|category_id)|UNIQUE constraint failed: (?:help_articles\.handle|help_article_previous_handles\.handle))(?::|$)/u;

function isSaveAbort(error: unknown): boolean {
  for (let current = error; current instanceof Error; current = current.cause) {
    if (SAVE_ABORT_VIOLATION_PATTERN.test(current.message)) {
      return true;
    }
  }
  return false;
}

const LIST_COLUMNS = {
  id: helpArticles.id,
  handle: helpArticles.handle,
  title: helpArticles.title,
  categoryId: helpArticles.categoryId,
  categoryName: helpCategories.name,
  pinned: helpArticles.pinned,
  status: helpArticles.status,
  createdByAdminId: helpArticles.createdByAdminId,
  sortOrder: helpArticles.sortOrder,
  revision: helpArticles.revision,
  createdAt: helpArticles.createdAt,
  updatedAt: helpArticles.updatedAt,
};

const RECORD_COLUMNS = {
  ...LIST_COLUMNS,
  subtitle: helpArticles.subtitle,
  bodyMarkdown: helpArticles.bodyMarkdown,
};

const categoryExists = (categoryId: string): SQL =>
  sql`EXISTS (SELECT 1 FROM ${helpCategories} WHERE ${eq(helpCategories.id, categoryId)})`;

// 一括の書き込みの中では前の文の結果で後の文を分けられないため、カテゴリの存在とハンドルの使用中の判定を記事の行のカテゴリの値に入れる。
// 満たさなければNULLになり、NOT NULL制約の違反で後続の文を含む全体が取り消される。同時の保存は、D1が書き込みを直列に実行するため後の保存の判定で使用中になる
function guardedCategoryId(
  categoryId: string,
  claimedHandle:
    { readonly handle: string; readonly exceptOwnerId?: string } | undefined,
): SQL {
  const handleFree =
    claimedHandle === undefined
      ? undefined
      : sql`NOT ${handleOccupiedCondition(
          HELP_ARTICLE_HANDLE_NAMESPACE,
          claimedHandle.handle,
          claimedHandle.exceptOwnerId === undefined
            ? {}
            : { exceptOwnerId: claimedHandle.exceptOwnerId },
        )}`;
  return sql`CASE WHEN ${and(categoryExists(categoryId), handleFree)} THEN ${categoryId} ELSE NULL END`;
}

// 副問い合わせは保存先のカテゴリの下書きを含む記事を読み、更新する記事は移動前のカテゴリに属するため数えない
const tailSortOrder = (categoryId: string): SQL =>
  sql`(SELECT COALESCE(MAX(${helpArticles.sortOrder}), 0) + 1 FROM ${helpArticles} WHERE ${eq(helpArticles.categoryId, categoryId)})`;

@injectable()
export class D1HelpArticleStore implements HelpArticleStore {
  constructor(
    @inject(PLATFORM_TYPES.Database) private readonly db: Database,
    @inject(SEARCH_TYPES.IndexStatements)
    private readonly indexStatements: SearchIndexStatements,
  ) {}

  findById(id: string): Promise<HelpArticleRecord | undefined> {
    return this.#readRecord(id);
  }

  async listAll(): Promise<readonly HelpArticleListRecord[]> {
    return this.db
      .select(LIST_COLUMNS)
      .from(helpArticles)
      .innerJoin(helpCategories, eq(helpCategories.id, helpArticles.categoryId))
      .orderBy(asc(helpArticles.id));
  }

  // 旧ハンドルの列はNOCASEで照合するため、大文字小文字の違いを同じ文字列として引く
  async findPreviousHandleHolder(
    handle: string,
    exceptArticleId?: string,
  ): Promise<string | undefined> {
    const [row] = await this.db
      .select({ ownerId: helpArticlePreviousHandles.ownerId })
      .from(helpArticlePreviousHandles)
      .where(
        and(
          eq(helpArticlePreviousHandles.handle, handle),
          exceptArticleId === undefined
            ? undefined
            : ne(helpArticlePreviousHandles.ownerId, exceptArticleId),
          isNull(helpArticlePreviousHandles.deletedAt),
        ),
      )
      .limit(1);
    return row?.ownerId;
  }

  isHandleOccupied(handle: string, exceptArticleId?: string): Promise<boolean> {
    return isHandleOccupied(
      this.db,
      HELP_ARTICLE_HANDLE_NAMESPACE,
      handle,
      exceptArticleId === undefined ? {} : { exceptOwnerId: exceptArticleId },
    );
  }

  async create(input: HelpArticleCreateInput): Promise<HelpArticleSaveResult> {
    const { id, write, now } = input;
    try {
      await this.db.batch([
        ...buildAuditLogStatements(this.db, input.audit),
        this.db.insert(helpArticles).values({
          id,
          ...this.#contentOf(write),
          categoryId: guardedCategoryId(write.categoryId, {
            handle: write.handle,
          }),
          sortOrder: tailSortOrder(write.categoryId),
          createdByAdminId: input.createdByAdminId,
          revision: 1,
          createdAt: now,
          updatedAt: now,
        }),
        // 現在のハンドルの書き込みの後に置き、同じ文字列を他の記事の旧ハンドルとして残さない
        previousHandleRelease(this.db, HELP_ARTICLE_HANDLE_NAMESPACE, {
          handle: write.handle,
          exceptOwnerId: id,
        }),
        ...this.#indexStatementsFor(id, write, now),
      ]);
    } catch (error) {
      if (!isSaveAbort(error)) {
        throw error;
      }
      return (await this.#categoryMissing(write.categoryId))
        ? { kind: 'category-missing' }
        : { kind: 'handle-unavailable' };
    }
    return this.#savedResultOf(id);
  }

  async update(input: HelpArticleUpdateInput): Promise<HelpArticleSaveResult> {
    const { id, write, handleChange, now } = input;
    try {
      await this.db.batch([
        ...buildAuditLogStatements(this.db, input.audit),
        helpArticleExistsGuard(this.db, {
          id,
          expectedRevision: input.expectedRevision,
        }),
        this.db
          .update(helpArticles)
          .set({
            ...this.#contentOf(write),
            categoryId: guardedCategoryId(
              write.categoryId,
              handleChange.kind === 'changed'
                ? { handle: handleChange.next, exceptOwnerId: id }
                : undefined,
            ),
            ...(input.categoryChanged
              ? { sortOrder: tailSortOrder(write.categoryId) }
              : {}),
            revision: sql`${helpArticles.revision} + 1`,
            updatedAt: now,
          })
          .where(eq(helpArticles.id, id)),
        ...this.#handleStatements(input),
        ...this.#indexStatementsFor(id, write, now),
      ]);
    } catch (error) {
      if (!isSaveAbort(error)) {
        throw error;
      }
      return this.#classifyUpdateAbort(input);
    }
    return this.#savedResultOf(id);
  }

  // 旧ハンドルは記事を参照する外部キーを持つため、記事より先に消す
  async delete(input: {
    readonly id: string;
    readonly audit: PreparedAuditEntry;
  }): Promise<'deleted' | 'not-found'> {
    const { id } = input;
    try {
      await this.db.batch([
        ...buildAuditLogStatements(this.db, input.audit),
        helpArticleExistsGuard(this.db, { id }),
        ...this.indexStatements.deleteSources(HELP_ARTICLE_SEARCH_TARGET.name, [
          id,
        ]),
        previousHandleDelete(this.db, HELP_ARTICLE_HANDLE_NAMESPACE, id),
        this.db.delete(helpArticles).where(eq(helpArticles.id, id)),
      ]);
      return 'deleted';
    } catch (error) {
      if (isHelpArticleGuardRejection(error)) {
        return 'not-found';
      }
      throw error;
    }
  }

  // 並べ替えの画面を開いた後にカテゴリが消えていれば監査ログの条件で、記事の集合が変わっていれば確認の文で全体を取り消す。
  // 並び順の変更は公開の内容を変えないため、索引の版にも使う版と更新日時を変えない
  async reorder(input: {
    readonly categoryId: string;
    readonly orderedIds: readonly string[];
    readonly audit: PreparedAuditEntry;
  }): Promise<HelpReorderResult> {
    const { categoryId, orderedIds } = input;
    const ids = JSON.stringify(orderedIds);
    try {
      await this.db.batch([
        ...buildAuditLogStatements(this.db, input.audit, {
          kind: 'condition',
          condition: categoryExists(categoryId),
        }),
        helpOrderGuard(this.db, { kind: 'articles', categoryId, orderedIds }),
        // 順序をJSONの配列1つで渡し、件数によらず1文で並び順を配列の位置に揃える
        this.db
          .update(helpArticles)
          .set({
            sortOrder: sql`(SELECT CAST(key AS INTEGER) + 1 FROM json_each(${ids}) WHERE value = ${helpArticles.id})`,
            updatedAt: keepUpdatedAt,
          })
          .where(
            and(
              eq(helpArticles.categoryId, categoryId),
              sql`${helpArticles.id} IN (SELECT value FROM json_each(${ids}))`,
            ),
          ),
      ]);
      return 'reordered';
    } catch (error) {
      if (isHelpOrderGuardRejection(error) || isAuditGuardRejection(error)) {
        return 'outdated';
      }
      throw error;
    }
  }

  #contentOf(write: HelpArticleWrite) {
    return {
      handle: write.handle,
      title: write.title,
      subtitle: write.subtitle,
      bodyMarkdown: write.bodyMarkdown,
      pinned: write.pinned,
      status: write.status,
    };
  }

  // 大文字小文字だけの変更は同じハンドルの表記の違いのため、旧ハンドルを変えない。解放は自分の変更前のハンドルの置き換えより前に置く
  #handleStatements(input: HelpArticleUpdateInput): BatchItem<'sqlite'>[] {
    const { handleChange } = input;
    if (handleChange.kind !== 'changed') {
      return [];
    }
    return [
      previousHandleRelease(this.db, HELP_ARTICLE_HANDLE_NAMESPACE, {
        handle: handleChange.next,
        exceptOwnerId: input.id,
      }),
      previousHandleUpsert(this.db, HELP_ARTICLE_HANDLE_NAMESPACE, {
        id: ulid(),
        ownerId: input.id,
        handle: handleChange.previous,
        now: input.now,
      }),
    ];
  }

  // 公開の記事は確定の後の索引の更新を待つ印を付け、下書きは検索に残さないよう同じ一括の書き込みで消す
  #indexStatementsFor(
    id: string,
    write: HelpArticleWrite,
    now: Date,
  ): readonly BatchItem<'sqlite'>[] {
    const target = HELP_ARTICLE_SEARCH_TARGET.name;
    return write.status === 'published'
      ? [this.indexStatements.markPending(target, id, now)]
      : this.indexStatements.deleteSources(target, [id]);
  }

  async #categoryMissing(categoryId: string): Promise<boolean> {
    const rows = await this.db
      .select({ one: sql<number>`1` })
      .from(helpCategories)
      .where(eq(helpCategories.id, categoryId))
      .limit(1);
    return rows.length === 0;
  }

  // 取り消された一括の書き込みは何も残さないため、読み直した状態で理由を分ける
  async #classifyUpdateAbort(
    input: HelpArticleUpdateInput,
  ): Promise<HelpArticleSaveRejection> {
    const [articles, categories] = await this.db.batch([
      this.db
        .select({ revision: helpArticles.revision })
        .from(helpArticles)
        .where(eq(helpArticles.id, input.id)),
      this.db
        .select({ id: helpCategories.id })
        .from(helpCategories)
        .where(eq(helpCategories.id, input.write.categoryId)),
    ]);
    const [article] = articles;
    if (article === undefined) {
      return { kind: 'not-found' };
    }
    if (article.revision !== input.expectedRevision) {
      return { kind: 'conflict' };
    }
    if (categories.length === 0) {
      return { kind: 'category-missing' };
    }
    return { kind: 'handle-unavailable' };
  }

  // 確定の直後に別の操作で削除された記事は、保存の後の状態として不在を返す
  async #savedResultOf(id: string): Promise<HelpArticleSaveResult> {
    const record = await this.#readRecord(id);
    return record === undefined
      ? { kind: 'not-found' }
      : { kind: 'saved', record };
  }

  async #readRecord(id: string): Promise<HelpArticleRecord | undefined> {
    const [articles, previousHandles] = await this.db.batch([
      this.db
        .select(RECORD_COLUMNS)
        .from(helpArticles)
        .innerJoin(
          helpCategories,
          eq(helpCategories.id, helpArticles.categoryId),
        )
        .where(eq(helpArticles.id, id)),
      this.db
        .select({ handle: helpArticlePreviousHandles.handle })
        .from(helpArticlePreviousHandles)
        .where(
          and(
            eq(helpArticlePreviousHandles.ownerId, id),
            isNull(helpArticlePreviousHandles.deletedAt),
          ),
        ),
    ]);
    const [article] = articles;
    if (article === undefined) {
      return undefined;
    }
    return { ...article, previousHandle: previousHandles[0]?.handle ?? null };
  }
}
