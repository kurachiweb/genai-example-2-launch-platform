import { snakeCase } from 'drizzle-orm/sqlite-core';

import { previousHandleColumns } from '../handles/previous-handle-columns.ts';
import { helpArticles } from './help-articles.ts';

export const helpArticlePreviousHandles = snakeCase.table(
  'help_article_previous_handles',
  previousHandleColumns({
    ownerColumnName: 'article_id',
    references: () => helpArticles.id,
  }),
);
