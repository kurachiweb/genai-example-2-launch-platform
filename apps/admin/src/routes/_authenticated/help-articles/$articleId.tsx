import { createFileRoute } from '@tanstack/react-router';

import { HELP_ARTICLE_FORM_EDIT_LABEL } from '../../../components/help/help-messages.ts';
import { HelpArticleEditPage } from '../../../components/pages/help-article-edit-page.tsx';
import { loadAdminHelpArticlePage } from '../../../graphql/admin-help-articles.ts';
import { buildAdminPageHead } from '../../../head/page-heads.ts';

export const Route = createFileRoute(
  '/_authenticated/help-articles/$articleId',
)({
  loader: loadAdminHelpArticlePage,
  head: () => buildAdminPageHead({ title: HELP_ARTICLE_FORM_EDIT_LABEL }),
  component: HelpArticleEditPage,
});
