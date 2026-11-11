import { helpSchemaModule } from '../../src/presentation/graphql/modules/help/index.ts';
import { mediaSchemaModule } from '../../src/presentation/graphql/modules/media/index.ts';
import {
  createGraphQLGateway,
  type GatewayCallOptions,
} from './graphql-gateway.ts';
import type { HelpArticleAuthorFields } from './help-article-graphql-documents.ts';

export interface HelpArticleSummaryFields {
  readonly handle: string;
  readonly title: string;
  readonly subtitle: string;
  readonly pinned: boolean;
}

export interface HelpCenterCategoryFields {
  readonly name: string;
  readonly articles: readonly HelpArticleSummaryFields[];
}

export interface HelpArticleFields {
  readonly __typename: 'HelpArticle';
  readonly handle: string;
  readonly title: string;
  readonly subtitle: string;
  readonly body: string;
  readonly categoryName: string;
  readonly author: HelpArticleAuthorFields | null;
  readonly updatedAt: string;
  readonly relatedArticles: readonly HelpArticleSummaryFields[];
}

export interface HelpArticleRedirectFields {
  readonly __typename: 'HelpArticleRedirect';
  readonly handle: string;
}

export interface HelpArticleLinkFields {
  readonly handle: string;
  readonly title: string;
}

export interface HelpSearchHitFields {
  readonly handle: string;
  readonly title: string;
  readonly subtitle: string;
  readonly categoryName: string;
}

const HELP_ARTICLE_SUMMARY_FIELDS = /* GraphQL */ `
  handle
  title
  subtitle
  pinned
`;

export const CLIENT_HELP_CENTER = /* GraphQL */ `
  query ClientHelpCenter {
    helpCenter {
      name
      articles {
        ${HELP_ARTICLE_SUMMARY_FIELDS}
      }
    }
  }
`;

export const CLIENT_HELP_ARTICLE = /* GraphQL */ `
  query ClientHelpArticle($handle: String!) {
    helpArticle(handle: $handle) {
      __typename
      ... on HelpArticle {
        handle
        title
        subtitle
        body
        categoryName
        author {
          nickname
          title
          avatar {
            id
            objectKey
          }
        }
        updatedAt
        relatedArticles {
          ${HELP_ARTICLE_SUMMARY_FIELDS}
        }
      }
      ... on HelpArticleRedirect {
        handle
      }
    }
  }
`;

export const CLIENT_PINNED_HELP_ARTICLES = /* GraphQL */ `
  query ClientPinnedHelpArticles {
    pinnedHelpArticles {
      handle
      title
    }
  }
`;

export const CLIENT_HELP_ARTICLE_SEARCH = /* GraphQL */ `
  query ClientHelpArticleSearch($query: String!) {
    helpArticleSearch(query: $query) {
      handle
      title
      subtitle
      categoryName
    }
  }
`;

// 呼び出し元の既定は利用者側で、セッションを付けない
export const helpPublicGateway = createGraphQLGateway({
  documents: [
    CLIENT_HELP_CENTER,
    CLIENT_HELP_ARTICLE,
    CLIENT_PINNED_HELP_ARTICLES,
    CLIENT_HELP_ARTICLE_SEARCH,
  ],
  schemaModules: [mediaSchemaModule, helpSchemaModule],
});

export function fetchHelpCenter(options?: GatewayCallOptions) {
  return helpPublicGateway.call<{
    helpCenter: HelpCenterCategoryFields[] | null;
  }>(CLIENT_HELP_CENTER, {}, options);
}

export function fetchHelpArticle(handle: string, options?: GatewayCallOptions) {
  return helpPublicGateway.call<{
    helpArticle: HelpArticleFields | HelpArticleRedirectFields | null;
  }>(CLIENT_HELP_ARTICLE, { handle }, options);
}

export function fetchPinnedHelpArticles(options?: GatewayCallOptions) {
  return helpPublicGateway.call<{
    pinnedHelpArticles: HelpArticleLinkFields[] | null;
  }>(CLIENT_PINNED_HELP_ARTICLES, {}, options);
}

export function searchHelpArticles(
  query: string,
  options?: GatewayCallOptions,
) {
  return helpPublicGateway.call<{
    helpArticleSearch: HelpSearchHitFields[] | null;
  }>(CLIENT_HELP_ARTICLE_SEARCH, { query }, options);
}
