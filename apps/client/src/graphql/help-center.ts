import { graphqlQueryOptions } from '../../lib/start/graphql/graphql-query-options.ts';
import {
  ClientHelpArticleDocument,
  ClientHelpArticleSearchDocument,
  ClientHelpCenterDocument,
  ClientPinnedHelpArticlesDocument,
} from './generated/graphql.ts';

export const helpCenterQueryOptions = () =>
  graphqlQueryOptions(ClientHelpCenterDocument, {});

export const helpArticleQueryOptions = (handle: string) =>
  graphqlQueryOptions(ClientHelpArticleDocument, { handle });

export const helpArticleSearchQueryOptions = (query: string) =>
  graphqlQueryOptions(ClientHelpArticleSearchDocument, { query });

export const pinnedHelpArticlesQueryOptions = () =>
  graphqlQueryOptions(ClientPinnedHelpArticlesDocument, {});
