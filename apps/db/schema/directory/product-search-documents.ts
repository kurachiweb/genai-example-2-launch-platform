import { snakeCase } from 'drizzle-orm/sqlite-core';

import {
  searchDocumentColumns,
  searchDocumentStatusIndex,
  searchTextColumn,
} from '../_shared/search-documents.ts';

export const productSearchDocuments = snakeCase.table(
  'product_search_documents',
  {
    ...searchDocumentColumns(),
    name: searchTextColumn('name'),
    tagline: searchTextColumn('tagline'),
  },
  (table) => [searchDocumentStatusIndex('product_search_documents', table)],
);
