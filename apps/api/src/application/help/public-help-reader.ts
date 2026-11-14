import { inject, injectable } from 'inversify';

import { checkHandleFormat } from '../../../common-lib/handles/handle-rules.ts';
import {
  HELP_ARTICLE_HANDLE_RULE,
  HELP_SEARCH_RESULT_LIMIT,
} from '../../../common-lib/help/help-input-rules.ts';
import {
  groupPublishedArticles,
  sortHelpArticles,
} from '../../../common-lib/help/help-ordering.ts';
import {
  buildFtsMatchExpression,
  normalizeSearchTerms,
} from '../../../common-lib/search/search-terms.ts';
import type { HelpAuthorLookup, HelpAuthorView } from './help-authors.ts';
import { HELP_TYPES } from './help-types.ts';
import type {
  PublicHelpArticleDetailRecord,
  PublicHelpStore,
  PublishedHelpArticleRecord,
} from './ports.ts';

export interface HelpArticleSummaryView {
  readonly handle: string;
  readonly title: string;
  readonly subtitle: string;
  readonly pinned: boolean;
}

export interface HelpCenterCategoryView {
  readonly name: string;
  readonly articles: readonly HelpArticleSummaryView[];
}

export interface PublicHelpArticleView {
  readonly handle: string;
  readonly title: string;
  readonly subtitle: string;
  readonly bodyMarkdown: string;
  readonly categoryName: string;
  // nullは削除済みの管理者
  readonly author: HelpAuthorView | null;
  readonly updatedAt: Date;
  readonly relatedArticles: readonly HelpArticleSummaryView[];
}

export type PublicHelpArticleResult =
  | { readonly kind: 'article'; readonly article: PublicHelpArticleView }
  | { readonly kind: 'redirect'; readonly handle: string }
  | { readonly kind: 'not-found' };

export interface HelpSearchHitView extends HelpArticleSummaryView {
  readonly categoryName: string;
}

export interface PinnedHelpArticleView {
  readonly handle: string;
  readonly title: string;
}

// ログインの有無を問わない利用者側の照会で、どの結果にも下書きの記事を含めない
export interface PublicHelpReader {
  helpCenter(): Promise<readonly HelpCenterCategoryView[]>;
  findArticle(handle: string): Promise<PublicHelpArticleResult>;
  pinned(): Promise<readonly PinnedHelpArticleView[]>;
  // queryはリゾルバが前後の空白を除き上限の文字数に切り詰めた検索語
  search(query: string): Promise<readonly HelpSearchHitView[]>;
}

const NOT_FOUND: PublicHelpArticleResult = Object.freeze({ kind: 'not-found' });

const summaryOf = ({
  handle,
  title,
  subtitle,
  pinned,
}: PublishedHelpArticleRecord): HelpArticleSummaryView => ({
  handle,
  title,
  subtitle,
  pinned,
});

@injectable()
export class StorePublicHelpReader implements PublicHelpReader {
  constructor(
    @inject(HELP_TYPES.PublicHelpStore)
    private readonly store: PublicHelpStore,
    @inject(HELP_TYPES.HelpAuthorLookup)
    private readonly authors: HelpAuthorLookup,
  ) {}

  async helpCenter(): Promise<readonly HelpCenterCategoryView[]> {
    const groups = await this.#publishedGroups();
    return groups.map(({ category, articles }) => ({
      name: category.name,
      articles: articles.map(summaryOf),
    }));
  }

  // 存在しない・下書き・形式に合わないハンドルは、理由を推測させないよう同じ結果にする
  async findArticle(handle: string): Promise<PublicHelpArticleResult> {
    if (checkHandleFormat(handle, HELP_ARTICLE_HANDLE_RULE) !== 'ok') {
      return NOT_FOUND;
    }
    const resolution = await this.store.resolve(handle);
    switch (resolution.kind) {
      case 'none':
        return NOT_FOUND;
      case 'previous': {
        // 旧ハンドルの解決は保持者の状態を見ないため、転送の前に公開を確かめる
        const current = await this.store.findPublishedHandle(
          resolution.articleId,
        );
        return current === undefined
          ? NOT_FOUND
          : { kind: 'redirect', handle: current };
      }
      case 'current': {
        const detail = await this.store.findPublishedDetail(
          resolution.articleId,
        );
        return detail === undefined
          ? NOT_FOUND
          : { kind: 'article', article: await this.#viewOf(detail) };
      }
    }
  }

  async pinned(): Promise<readonly PinnedHelpArticleView[]> {
    const groups = await this.#publishedGroups();
    return groups.flatMap(({ articles }) =>
      articles
        .filter((article) => article.pinned)
        .map(({ handle, title }) => ({ handle, title })),
    );
  }

  async search(query: string): Promise<readonly HelpSearchHitView[]> {
    const expression = buildFtsMatchExpression(normalizeSearchTerms(query));
    if (expression === undefined) {
      return [];
    }
    const hits = await this.store.search(expression, HELP_SEARCH_RESULT_LIMIT);
    return hits.map((hit) => ({
      ...summaryOf(hit),
      categoryName: hit.categoryName,
    }));
  }

  async #publishedGroups() {
    const { categories, articles } = await this.store.listPublished();
    return groupPublishedArticles(categories, articles);
  }

  async #viewOf(
    detail: PublicHelpArticleDetailRecord,
  ): Promise<PublicHelpArticleView> {
    const authors = await this.authors.find([detail.createdByAdminId]);
    return {
      handle: detail.handle,
      title: detail.title,
      subtitle: detail.subtitle,
      bodyMarkdown: detail.bodyMarkdown,
      categoryName: detail.categoryName,
      author: authors.get(detail.createdByAdminId) ?? null,
      updatedAt: detail.updatedAt,
      relatedArticles: sortHelpArticles(detail.sameCategory).map(summaryOf),
    };
  }
}
