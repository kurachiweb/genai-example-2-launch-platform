import { defineSearchIndex } from '../../search/search-index-definition.ts';
import { productSearchDocuments } from './product-search-documents.ts';

export const PRODUCT_SEARCH_INDEX = defineSearchIndex({
  documents: productSearchDocuments,
  textColumns: [
    { column: productSearchDocuments.name, weight: 10 },
    { column: productSearchDocuments.tagline, weight: 5 },
  ],
  keywordsWeight: 1,
});
