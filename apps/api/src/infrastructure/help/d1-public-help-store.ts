import { and, asc, eq, ne, sql } from 'drizzle-orm';
import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { HELP_ARTICLE_SEARCH_INDEX } from '../../../db/schema/help/help-article-search-index.ts';
import {
  helpArticles,
  publishedHelpArticle,
} from '../../../db/schema/help/help-articles.ts';
import { helpCategories } from '../../../db/schema/help/help-categories.ts';
import { ftsRankedSources } from '../../../db/search/fts-query.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import { resolveHandle } from '../../../lib/workers/handles/handle-queries.ts';
import { HELP_ARTICLE_HANDLE_NAMESPACE } from '../../../lib/workers/help/help-article-handle-namespace.ts';
import type {
  PublicHelpArticleDetailRecord,
  PublicHelpResolution,
  PublicHelpSearchHitRecord,
  PublicHelpStore,
  PublishedHelpArticleRecord,
  PublishedHelpCategoryRecord,
} from '../../application/help/ports.ts';

const PUBLISHED_COLUMNS = {
  id: helpArticles.id,
  handle: helpArticles.handle,
  title: helpArticles.title,
  subtitle: helpArticles.subtitle,
  pinned: helpArticles.pinned,
  categoryId: helpArticles.categoryId,
  sortOrder: helpArticles.sortOrder,
  createdAt: helpArticles.createdAt,
};

const CATEGORY_COLUMNS = {
  id: helpCategories.id,
  name: helpCategories.name,
  sortOrder: helpCategories.sortOrder,
  createdAt: helpCategories.createdAt,
};

const SEARCH_MATCHES = sql.raw('help_article_search_matches');

@injectable()
export class D1PublicHelpStore implements PublicHelpStore {
  constructor(@inject(PLATFORM_TYPES.Database) private readonly db: Database) {}

  async listPublished(): Promise<{
    readonly categories: readonly PublishedHelpCategoryRecord[];
    readonly articles: readonly PublishedHelpArticleRecord[];
  }> {
    const [categories, articles] = await this.db.batch([
      this.db
        .select(CATEGORY_COLUMNS)
        .from(helpCategories)
        .orderBy(asc(helpCategories.id)),
      this.db
        .select(PUBLISHED_COLUMNS)
        .from(helpArticles)
        .where(publishedHelpArticle)
        .orderBy(asc(helpArticles.id)),
    ]);
    return { categories, articles };
  }

  async resolve(handle: string): Promise<PublicHelpResolution> {
    const resolution = await resolveHandle(
      this.db,
      HELP_ARTICLE_HANDLE_NAMESPACE,
      handle,
    );
    return resolution.kind === 'none'
      ? { kind: 'none' }
      : { kind: resolution.kind, articleId: resolution.ownerId };
  }

  async findPublishedDetail(
    articleId: string,
  ): Promise<PublicHelpArticleDetailRecord | undefined> {
    // 記事が下書き・不在なら副問い合わせがNULLになり、同カテゴリの記事も空になる
    const publishedCategoryId = sql`(SELECT ${helpArticles.categoryId} FROM ${helpArticles} WHERE ${and(eq(helpArticles.id, articleId), publishedHelpArticle)})`;
    const [details, sameCategory] = await this.db.batch([
      this.db
        .select({
          ...PUBLISHED_COLUMNS,
          bodyMarkdown: helpArticles.bodyMarkdown,
          categoryName: helpCategories.name,
          createdByAdminId: helpArticles.createdByAdminId,
          updatedAt: helpArticles.updatedAt,
        })
        .from(helpArticles)
        .innerJoin(
          helpCategories,
          eq(helpCategories.id, helpArticles.categoryId),
        )
        .where(and(eq(helpArticles.id, articleId), publishedHelpArticle)),
      this.db
        .select(PUBLISHED_COLUMNS)
        .from(helpArticles)
        .where(
          and(
            sql`${helpArticles.categoryId} = ${publishedCategoryId}`,
            ne(helpArticles.id, articleId),
            publishedHelpArticle,
          ),
        )
        .orderBy(asc(helpArticles.id)),
    ]);
    const [detail] = details;
    return detail === undefined ? undefined : { ...detail, sameCategory };
  }

  async findPublishedHandle(articleId: string): Promise<string | undefined> {
    const [row] = await this.db
      .select({ handle: helpArticles.handle })
      .from(helpArticles)
      .where(and(eq(helpArticles.id, articleId), publishedHelpArticle))
      .limit(1);
    return row?.handle;
  }

  // 索引文書は更新の遅れで記事より古いことがあるため、一致の判定と関連度だけに使い、公開の条件と表示の値は記事の側から読む
  async search(
    matchExpression: string,
    limit: number,
  ): Promise<readonly PublicHelpSearchHitRecord[]> {
    return (
      this.db
        .select({ ...PUBLISHED_COLUMNS, categoryName: helpCategories.name })
        .from(helpArticles)
        .innerJoin(
          sql`(${ftsRankedSources(HELP_ARTICLE_SEARCH_INDEX, matchExpression)}) AS ${SEARCH_MATCHES}`,
          sql`${SEARCH_MATCHES}.source_id = ${helpArticles.id}`,
        )
        .innerJoin(
          helpCategories,
          eq(helpCategories.id, helpArticles.categoryId),
        )
        .where(publishedHelpArticle)
        // bm25の値は小さいほど関連度が高い
        .orderBy(sql`${SEARCH_MATCHES}.rank`, asc(helpArticles.id))
        .limit(limit)
    );
  }
}
