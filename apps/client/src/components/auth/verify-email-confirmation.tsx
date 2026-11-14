import { useMutation } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

import { graphqlMutationOptions } from '../../../lib/start/graphql/graphql-query-options.ts';
import { ClientVerifyEmailDocument } from '../../graphql/generated/graphql.ts';
import {
  EMAIL_ALREADY_VERIFIED_MESSAGE,
  EMAIL_VERIFIED_MESSAGE,
  HOME_LINK_LABEL,
  LOGIN_LABEL,
  RESEND_AFTER_LOGIN_PREFIX,
  RESEND_AFTER_LOGIN_SUFFIX,
  RESEND_FROM_BANNER_GUIDE,
  VERIFY_EMAIL_ACTION_LABEL,
  VERIFY_EMAIL_DESCRIPTION,
  INVALID_LINK_MESSAGE,
} from './account-messages.ts';
import { INLINE_LINK_CLASS_NAME } from '../../../lib/components/navigation/inline-link-class.ts';
import { LinkConfirmation } from '../../../lib/components/auth/link-confirmation.tsx';
import { errorMessageOf } from '../../../lib/utilities/graphql/graphql-result.ts';
import { CLIENT_PROFILE } from '../../composition/app-profile.ts';
import { ResultNotice } from '../../../lib/components/feedback/result-notice.tsx';
import { HOME_PATH } from '../../../lib/utilities/auth/return-path.ts';
import { useViewer } from './use-viewer.ts';
import { useViewerRefresh } from './use-viewer-refresh.ts';

export function VerifyEmailConfirmation() {
  const verifyEmail = useMutation(
    graphqlMutationOptions(ClientVerifyEmailDocument),
  );
  const refreshViewer = useViewerRefresh();
  const viewer = useViewer();

  // 確認メールの再送はログイン中の未確認の利用者だけが共通ヘッダーの直下の帯から行える
  const resendGuide =
    viewer === null ? (
      <p>
        {RESEND_AFTER_LOGIN_PREFIX}
        <Link to="/auth/login" className={INLINE_LINK_CLASS_NAME}>
          {LOGIN_LABEL}
        </Link>
        {RESEND_AFTER_LOGIN_SUFFIX}
      </p>
    ) : (
      <p>
        {viewer.emailVerified
          ? EMAIL_ALREADY_VERIFIED_MESSAGE
          : RESEND_FROM_BANNER_GUIDE}
      </p>
    );

  return (
    <LinkConfirmation
      description={VERIFY_EMAIL_DESCRIPTION}
      actionLabel={VERIFY_EMAIL_ACTION_LABEL}
      confirm={async (token) => {
        await verifyEmail.mutateAsync({ variables: { token } });
        await refreshViewer();
      }}
      renderSuccess={() => (
        <ResultNotice tone="success" message={EMAIL_VERIFIED_MESSAGE}>
          <Link to={HOME_PATH} className={INLINE_LINK_CLASS_NAME}>
            {HOME_LINK_LABEL}
          </Link>
        </ResultNotice>
      )}
      invalidLinkMessage={INVALID_LINK_MESSAGE}
      failureMessageOf={(error) =>
        errorMessageOf(error, CLIENT_PROFILE.contactAvailable)
      }
      invalidLinkGuide={resendGuide}
    />
  );
}
