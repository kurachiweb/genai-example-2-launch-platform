import { createFileRoute } from '@tanstack/react-router';

import { parseHelpArticleOrderSearch } from '../../../components/help/help-article-order-search.ts';
import { HELP_ARTICLE_ORDER_TITLE } from '../../../components/help/help-messages.ts';
import { HelpArticleOrderPage } from '../../../components/pages/help-article-order-page.tsx';
import { loadAdminHelpArticlesPage } from '../../../graphql/admin-help-articles.ts';
import { buildAdminPageHead } from '../../../head/page-heads.ts';

export const Route = createFileRoute('/_authenticated/help-articles/order')({
  validateSearch: parseHelpArticleOrderSearch,
  loader: loadAdminHelpArticlesPage,
  head: () => buildAdminPageHead({ title: HELP_ARTICLE_ORDER_TITLE }),
  component: HelpArticleOrderPage,
});
