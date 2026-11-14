import { createFileRoute } from '@tanstack/react-router';

import { HELP_ARTICLE_FORM_CREATE_LABEL } from '../../../components/help/help-messages.ts';
import { requireHelpArticleEditor } from '../../../components/help/require-help-article-editor.ts';
import { HelpArticleNewPage } from '../../../components/pages/help-article-new-page.tsx';
import { loadAdminHelpArticleNewPage } from '../../../graphql/admin-help-articles.ts';
import { buildAdminPageHead } from '../../../head/page-heads.ts';

export const Route = createFileRoute('/_authenticated/help-articles/new')({
  beforeLoad: requireHelpArticleEditor,
  loader: loadAdminHelpArticleNewPage,
  head: () => buildAdminPageHead({ title: HELP_ARTICLE_FORM_CREATE_LABEL }),
  component: HelpArticleNewPage,
});
