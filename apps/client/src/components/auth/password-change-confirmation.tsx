import { useMutation } from '@tanstack/react-query';

import { graphqlMutationOptions } from '../../../lib/start/graphql/graphql-query-options.ts';
import { ClientConfirmPasswordChangeDocument } from '../../graphql/generated/graphql.ts';
import {
  PASSWORD_CHANGE_ACTION_LABEL,
  PASSWORD_CHANGE_DESCRIPTION,
  PASSWORD_CHANGED_MESSAGE,
  LOGIN_WITH_NEW_PASSWORD_MESSAGE,
  INVALID_LINK_MESSAGE,
} from './account-messages.ts';
import { CredentialChangeSuccess } from './credential-change-success.tsx';
import { LinkConfirmation } from '../../../lib/components/auth/link-confirmation.tsx';
import { errorMessageOf } from '../../../lib/utilities/graphql/graphql-result.ts';
import { CLIENT_PROFILE } from '../../composition/app-profile.ts';
import { RetryFromSettingsGuide } from './retry-from-settings-guide.tsx';
import { useViewerRefresh } from './use-viewer-refresh.ts';

export function PasswordChangeConfirmation() {
  const confirmPasswordChange = useMutation(
    graphqlMutationOptions(ClientConfirmPasswordChangeDocument),
  );
  const refreshViewer = useViewerRefresh();

  return (
    <LinkConfirmation
      description={PASSWORD_CHANGE_DESCRIPTION}
      actionLabel={PASSWORD_CHANGE_ACTION_LABEL}
      confirm={async (token) => {
        const { confirmPasswordChange: result } =
          await confirmPasswordChange.mutateAsync({ variables: { token } });
        await refreshViewer();
        return result.viewer !== null;
      }}
      renderSuccess={(signedIn) => (
        <CredentialChangeSuccess
          message={PASSWORD_CHANGED_MESSAGE}
          loginMessage={LOGIN_WITH_NEW_PASSWORD_MESSAGE}
          signedIn={signedIn}
        />
      )}
      invalidLinkMessage={INVALID_LINK_MESSAGE}
      failureMessageOf={(error) =>
        errorMessageOf(error, CLIENT_PROFILE.contactAvailable)
      }
      invalidLinkGuide={<RetryFromSettingsGuide />}
    />
  );
}
