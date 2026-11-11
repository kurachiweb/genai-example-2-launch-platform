import { asc } from 'drizzle-orm';

import { HELP_CATEGORY_OTHER_ID } from '../../common-lib/help/help-category-constants.ts';
import { helpArticlePreviousHandles } from '../../db/schema/help/help-article-previous-handles.ts';
import { helpArticles } from '../../db/schema/help/help-articles.ts';
import { db } from '../../lib/workers/help/testing/help-fixtures.ts';
import type { GatewayCallOptions } from './graphql-gateway.ts';
import {
  ADMIN_HELP_ARTICLE,
  ADMIN_HELP_ARTICLES,
  type AdminHelpArticleFields,
  type AdminHelpArticleRowFields,
  CREATE_HELP_ARTICLE,
  DELETE_HELP_ARTICLE,
  HELP_ARTICLE_HANDLE_AVAILABILITY,
  REORDER_HELP_ARTICLES,
  UPDATE_HELP_ARTICLE,
} from './help-article-graphql-documents.ts';
import { helpAdminGateway } from './help-graphql-operations.ts';

export interface HelpArticleFieldsInput {
  readonly handle: string;
  readonly title: string;
  readonly subtitle: string;
  readonly body: string;
  readonly categoryId: string;
  readonly pinned: boolean;
  readonly status: 'DRAFT' | 'PUBLISHED';
}

export function helpArticleFieldsOf(
  overrides: Partial<HelpArticleFieldsInput> = {},
): HelpArticleFieldsInput {
  return {
    handle: 'getting-started',
    title: 'はじめに',
    subtitle: '最初に読む記事',
    body: '## 使い方\n\n本文です。',
    categoryId: HELP_CATEGORY_OTHER_ID,
    pinned: false,
    status: 'PUBLISHED',
    ...overrides,
  };
}

export function fetchAdminHelpArticles(options?: GatewayCallOptions) {
  return helpAdminGateway.call<{
    adminHelpArticles: AdminHelpArticleRowFields[] | null;
  }>(ADMIN_HELP_ARTICLES, {}, options);
}

export function fetchAdminHelpArticle(
  id: string,
  options?: GatewayCallOptions,
) {
  return helpAdminGateway.call<{
    adminHelpArticle: AdminHelpArticleFields | null;
  }>(ADMIN_HELP_ARTICLE, { id }, options);
}

export function fetchHelpArticleHandleAvailability(
  variables: { readonly handle: string; readonly articleId?: string | null },
  options?: GatewayCallOptions,
) {
  return helpAdminGateway.call<{
    helpArticleHandleAvailability: string | null;
  }>(HELP_ARTICLE_HANDLE_AVAILABILITY, variables, options);
}

export function createHelpArticle(
  input: {
    readonly fields: HelpArticleFieldsInput;
    readonly reason?: string | null;
  },
  options?: GatewayCallOptions,
) {
  return helpAdminGateway.call<{
    createHelpArticle: AdminHelpArticleFields | null;
  }>(CREATE_HELP_ARTICLE, { input }, options);
}

export function updateHelpArticle(
  input: {
    readonly id: string;
    readonly expectedRevision: number;
    readonly fields: HelpArticleFieldsInput;
    readonly reason?: string | null;
  },
  options?: GatewayCallOptions,
) {
  return helpAdminGateway.call<{
    updateHelpArticle: AdminHelpArticleFields | null;
  }>(UPDATE_HELP_ARTICLE, { input }, options);
}

export function deleteHelpArticle(
  variables: { readonly id: string; readonly reason?: string | null },
  options?: GatewayCallOptions,
) {
  return helpAdminGateway.call<{
    deleteHelpArticle: { id: string } | null;
  }>(DELETE_HELP_ARTICLE, variables, options);
}

export function reorderHelpArticles(
  variables: {
    readonly categoryId: string;
    readonly orderedIds: readonly string[];
  },
  options?: GatewayCallOptions,
) {
  return helpAdminGateway.call<{
    reorderHelpArticles: AdminHelpArticleRowFields[] | null;
  }>(REORDER_HELP_ARTICLES, variables, options);
}

export function readHelpArticleRows() {
  return db
    .select({
      id: helpArticles.id,
      handle: helpArticles.handle,
      title: helpArticles.title,
      subtitle: helpArticles.subtitle,
      bodyMarkdown: helpArticles.bodyMarkdown,
      categoryId: helpArticles.categoryId,
      sortOrder: helpArticles.sortOrder,
      revision: helpArticles.revision,
    })
    .from(helpArticles)
    .orderBy(asc(helpArticles.id));
}

export function readHelpPreviousHandles() {
  return db
    .select({
      ownerId: helpArticlePreviousHandles.ownerId,
      handle: helpArticlePreviousHandles.handle,
    })
    .from(helpArticlePreviousHandles)
    .orderBy(asc(helpArticlePreviousHandles.ownerId));
}
