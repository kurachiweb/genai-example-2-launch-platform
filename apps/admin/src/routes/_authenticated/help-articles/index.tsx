import { createFileRoute } from '@tanstack/react-router';

import { parseHelpArticleFilter } from '../../../components/help/help-article-filter.ts';
import { HELP_ARTICLES_TITLE } from '../../../components/help/help-messages.ts';
import { HelpArticlesPage } from '../../../components/pages/help-articles-page.tsx';
import { loadAdminHelpArticlesPage } from '../../../graphql/admin-help-articles.ts';
import { buildAdminPageHead } from '../../../head/page-heads.ts';

export const Route = createFileRoute('/_authenticated/help-articles/')({
  validateSearch: parseHelpArticleFilter,
  loader: loadAdminHelpArticlesPage,
  head: () => buildAdminPageHead({ title: HELP_ARTICLES_TITLE }),
  component: HelpArticlesPage,
});
