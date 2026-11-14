import { defineSearchIndex } from '../../search/search-index-definition.ts';
import { helpArticleSearchDocuments } from './help-article-search-documents.ts';

export const HELP_ARTICLE_SEARCH_INDEX = defineSearchIndex({
  documents: helpArticleSearchDocuments,
  textColumns: [
    { column: helpArticleSearchDocuments.title, weight: 10 },
    { column: helpArticleSearchDocuments.subtitle, weight: 5 },
  ],
  keywordsWeight: 1,
});
