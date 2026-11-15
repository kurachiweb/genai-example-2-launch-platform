import { snakeCase } from 'drizzle-orm/sqlite-core';

import {
  searchDocumentColumns,
  searchDocumentStatusIndex,
  searchTextColumn,
} from '../_shared/search-documents.ts';

export const helpArticleSearchDocuments = snakeCase.table(
  'help_article_search_documents',
  {
    ...searchDocumentColumns(),
    title: searchTextColumn('title'),
    subtitle: searchTextColumn('subtitle'),
  },
  (table) => [
    searchDocumentStatusIndex('help_article_search_documents', table),
  ],
);
