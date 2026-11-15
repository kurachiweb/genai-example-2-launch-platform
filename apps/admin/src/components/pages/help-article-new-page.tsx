import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';

import { hasRole } from '../../../common-lib/admin/admin-roles.ts';
import { AdminPageHeader } from '../../../lib/components/admin/admin-page-header.tsx';
import { notify } from '../../../lib/components/feedback/notify.ts';
import { invalidateHelpArticleQueries } from '../../graphql/admin-help-articles.ts';
import {
  adminHelpCategoriesQueryOptions,
  toHelpCategories,
} from '../../graphql/admin-help-categories.ts';
import { HelpArticleForm } from '../help/help-article-form.tsx';
import {
  HELP_ARTICLE_CREATED_MESSAGE,
  HELP_ARTICLE_FORM_CREATE_LABEL,
} from '../help/help-messages.ts';
import { useAdminRole } from '../layout/use-current-admin.ts';

export function HelpArticleNewPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const readOnly = !hasRole(useAdminRole(), 'moderator');
  const { data: categories } = useSuspenseQuery({
    ...adminHelpCategoriesQueryOptions(),
    select: toHelpCategories,
  });

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-8">
      <AdminPageHeader title={HELP_ARTICLE_FORM_CREATE_LABEL} />
      <HelpArticleForm
        mode="create"
        categories={categories}
        readOnly={readOnly}
        onSaved={(article) => {
          notify.success(HELP_ARTICLE_CREATED_MESSAGE);
          void invalidateHelpArticleQueries(queryClient);
          void navigate({
            to: '/help-articles/$articleId',
            params: { articleId: article.id },
          });
        }}
      />
    </div>
  );
}
