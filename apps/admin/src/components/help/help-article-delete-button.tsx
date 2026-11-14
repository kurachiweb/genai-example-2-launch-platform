import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { Trash2Icon } from 'lucide-react';
import { useState } from 'react';

import { ConfirmActionDialog } from '../../../lib/components/admin/confirm-action-dialog.tsx';
import { notify } from '../../../lib/components/feedback/notify.ts';
import { INLINE_LINK_CLASS_NAME } from '../../../lib/components/navigation/inline-link-class.ts';
import { Button } from '../../../lib/components/ui/button/button.tsx';
import { graphqlMutationOptions } from '../../../lib/start/graphql/graphql-query-options.ts';
import { cn } from '../../../lib/utilities/class-names.ts';
import {
  errorMessageOf,
  GraphQLClientError,
} from '../../../lib/utilities/graphql/graphql-result.ts';
import { ADMIN_PROFILE } from '../../composition/app-profile.ts';
import { refreshHelpArticleQueriesAfterDelete } from '../../graphql/admin-help-articles.ts';
import { AdminDeleteHelpArticleDocument } from '../../graphql/generated/graphql.ts';
import {
  HELP_ARTICLE_DELETE_CONFIRM_LABEL,
  HELP_ARTICLE_DELETE_DESCRIPTION,
  HELP_ARTICLE_DELETE_LABEL,
  HELP_ARTICLE_DELETED_MESSAGE,
  HELP_ARTICLES_LINK_LABEL,
  helpArticleDeleteTitle,
} from './help-messages.ts';

export interface HelpArticleDeleteButtonProps {
  readonly article: { readonly id: string; readonly title: string };
}

const HELP_ARTICLE_NOT_FOUND_CODE = 'help_article_not_found';

const failureMessageOf = (error: unknown): string =>
  errorMessageOf(error, ADMIN_PROFILE.contactAvailable);

const isAlreadyDeleted = (error: unknown): boolean =>
  error instanceof GraphQLClientError &&
  error.code === HELP_ARTICLE_NOT_FOUND_CODE;

// 既に削除されていた記事は削除し直せないため、続きの操作として一覧への導線を示す
const failureActionOf = (error: unknown) =>
  isAlreadyDeleted(error) ? (
    <Link
      to="/help-articles"
      className={cn(INLINE_LINK_CLASS_NAME, 'self-start text-sm')}
    >
      {HELP_ARTICLES_LINK_LABEL}
    </Link>
  ) : null;

export function HelpArticleDeleteButton({
  article,
}: HelpArticleDeleteButtonProps) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const remove = useMutation(
    graphqlMutationOptions(AdminDeleteHelpArticleDocument),
  );

  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => {
          setOpen(true);
        }}
      >
        <Trash2Icon aria-hidden="true" />
        {HELP_ARTICLE_DELETE_LABEL}
      </Button>
      <ConfirmActionDialog
        open={open}
        onOpenChange={setOpen}
        title={helpArticleDeleteTitle(article.title)}
        description={HELP_ARTICLE_DELETE_DESCRIPTION}
        confirmLabel={HELP_ARTICLE_DELETE_CONFIRM_LABEL}
        reason="optional"
        audited
        onConfirm={async ({ reason }) => {
          try {
            await remove.mutateAsync({ variables: { id: article.id, reason } });
          } catch (error) {
            // 一覧への導線の先で削除済みの記事を古いキャッシュのまま示さないため
            if (isAlreadyDeleted(error)) {
              void refreshHelpArticleQueriesAfterDelete(queryClient);
            }
            throw error;
          }
          await refreshHelpArticleQueriesAfterDelete(queryClient);
          notify.success(HELP_ARTICLE_DELETED_MESSAGE);
          await navigate({ to: '/help-articles' });
        }}
        failureMessageOf={failureMessageOf}
        failureActionOf={failureActionOf}
      />
    </>
  );
}
