import { useMutation } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

import { LinkConfirmation } from '../../../lib/components/auth/link-confirmation.tsx';
import { ResultNotice } from '../../../lib/components/feedback/result-notice.tsx';
import { INLINE_LINK_CLASS_NAME } from '../../../lib/components/navigation/inline-link-class.ts';
import { graphqlMutationOptions } from '../../../lib/start/graphql/graphql-query-options.ts';
import { HOME_PATH } from '../../../lib/utilities/auth/return-path.ts';
import { errorMessageOf } from '../../../lib/utilities/graphql/graphql-result.ts';
import { ADMIN_PROFILE } from '../../composition/app-profile.ts';
import { AdminConfirmEmailChangeDocument } from '../../graphql/generated/graphql.ts';
import {
  DASHBOARD_LINK_LABEL,
  EMAIL_CHANGE_ACTION_LABEL,
  EMAIL_CHANGE_DESCRIPTION,
  EMAIL_CHANGED_MESSAGE,
  INVALID_LINK_MESSAGE,
  LOGIN_PAGE_LINK_LABEL,
  LOGIN_WITH_NEW_EMAIL_MESSAGE,
  MY_ACCOUNT_LABEL,
  RETRY_FROM_MY_ACCOUNT_SUFFIX,
} from './admin-auth-messages.ts';
import { useAdminViewerRefresh } from './use-admin-viewer-refresh.ts';

const failureMessageOf = (error: unknown): string =>
  errorMessageOf(error, ADMIN_PROFILE.contactAvailable);

export function EmailChangeConfirmation() {
  const confirmEmailChange = useMutation(
    graphqlMutationOptions(AdminConfirmEmailChangeDocument),
  );
  const refreshViewer = useAdminViewerRefresh();

  return (
    <LinkConfirmation
      description={EMAIL_CHANGE_DESCRIPTION}
      actionLabel={EMAIL_CHANGE_ACTION_LABEL}
      confirm={async (token) => {
        const { confirmAdminEmailChange } =
          await confirmEmailChange.mutateAsync({ variables: { token } });
        // 確定はすべての端末のセッションを消し、確定した端末が同じ管理者としてログイン中だった時だけ発行し直すため、画面シェルの区画を描き直させる
        await refreshViewer();
        return confirmAdminEmailChange.viewer !== null;
      }}
      renderSuccess={(signedIn) =>
        signedIn ? (
          <ResultNotice tone="success" message={EMAIL_CHANGED_MESSAGE}>
            <Link to={HOME_PATH} className={INLINE_LINK_CLASS_NAME}>
              {DASHBOARD_LINK_LABEL}
            </Link>
          </ResultNotice>
        ) : (
          <ResultNotice
            tone="success"
            message={`${EMAIL_CHANGED_MESSAGE}${LOGIN_WITH_NEW_EMAIL_MESSAGE}`}
          >
            <Link to="/auth/login" className={INLINE_LINK_CLASS_NAME}>
              {LOGIN_PAGE_LINK_LABEL}
            </Link>
          </ResultNotice>
        )
      }
      invalidLinkMessage={INVALID_LINK_MESSAGE}
      invalidLinkGuide={
        <p>
          <Link to="/account" className={INLINE_LINK_CLASS_NAME}>
            {MY_ACCOUNT_LABEL}
          </Link>
          {RETRY_FROM_MY_ACCOUNT_SUFFIX}
        </p>
      }
      failureMessageOf={failureMessageOf}
    />
  );
}
