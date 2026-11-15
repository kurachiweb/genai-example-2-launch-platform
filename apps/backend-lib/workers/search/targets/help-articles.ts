import { and, eq, sql, type SQL } from 'drizzle-orm';

import { helpArticleSearchDocuments } from '../../../../db/schema/help/help-article-search-documents.ts';
import { HELP_ARTICLE_SEARCH_INDEX } from '../../../../db/schema/help/help-article-search-index.ts';
import {
  helpArticles,
  publishedHelpArticle,
} from '../../../../db/schema/help/help-articles.ts';
import { defineSearchTarget } from '../search-target-definition.ts';

const indexableHelpArticle = (sourceId: string): SQL | undefined =>
  and(eq(helpArticles.id, sourceId), publishedHelpArticle);

export const HELP_ARTICLE_SEARCH_TARGET = defineSearchTarget({
  name: 'help-article',
  fields: {
    title: { format: 'plain', textColumn: true, extract: false },
    subtitle: { format: 'plain', textColumn: true, extract: false },
    body: { format: 'markdown', textColumn: false, extract: true },
  },
  index: HELP_ARTICLE_SEARCH_INDEX,
  documents: helpArticleSearchDocuments,
  async read(db, sourceId) {
    const [row] = await db
      .select({
        title: helpArticles.title,
        subtitle: helpArticles.subtitle,
        bodyMarkdown: helpArticles.bodyMarkdown,
        revision: helpArticles.revision,
      })
      .from(helpArticles)
      .where(indexableHelpArticle(sourceId))
      .limit(1);
    return (
      row && {
        version: row.revision,
        fields: {
          title: row.title,
          subtitle: row.subtitle,
          body: row.bodyMarkdown,
        },
      }
    );
  },
  isIndexable: (sourceId) =>
    sql`SELECT 1 FROM ${helpArticles} WHERE ${indexableHelpArticle(sourceId)}`,
});
