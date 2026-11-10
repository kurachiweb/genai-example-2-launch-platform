import { PRODUCT_SEARCH_INDEX } from '../schema/directory/product-search-index.ts';
import type { SearchIndexDefinition } from './search-index-definition.ts';

export const SEARCH_INDEXES: readonly SearchIndexDefinition[] = [
  PRODUCT_SEARCH_INDEX,
];
