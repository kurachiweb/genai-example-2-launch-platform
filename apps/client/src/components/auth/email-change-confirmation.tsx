import { useMutation } from '@tanstack/react-query';

import { graphqlMutationOptions } from '../../../lib/start/graphql/graphql-query-options.ts';
import { ClientConfirmEmailChangeDocument } from '../../graphql/generated/graphql.ts';
import {
  EMAIL_CHANGE_ACTION_LABEL,
  EMAIL_CHANGE_DESCRIPTION,
  EMAIL_CHANGED_MESSAGE,
  LOGIN_WITH_NEW_EMAIL_MESSAGE,
} from './account-messages.ts';
import { CredentialChangeSuccess } from './credential-change-success.tsx';
import { LinkConfirmation } from './link-confirmation.tsx';
import { RetryFromSettingsGuide } from './retry-from-settings-guide.tsx';
import { useViewerRefresh } from './use-viewer-refresh.ts';

export function EmailChangeConfirmation() {
  const confirmEmailChange = useMutation(
    graphqlMutationOptions(ClientConfirmEmailChangeDocument),
  );
  const refreshViewer = useViewerRefresh();

  return (
    <LinkConfirmation
      description={EMAIL_CHANGE_DESCRIPTION}
      actionLabel={EMAIL_CHANGE_ACTION_LABEL}
      confirm={async (token) => {
        const { confirmEmailChange: result } =
          await confirmEmailChange.mutateAsync({ variables: { token } });
        await refreshViewer();
        return result.viewer !== null;
      }}
      renderSuccess={(signedIn) => (
        <CredentialChangeSuccess
          message={EMAIL_CHANGED_MESSAGE}
          loginMessage={LOGIN_WITH_NEW_EMAIL_MESSAGE}
          signedIn={signedIn}
        />
      )}
      invalidLinkGuide={<RetryFromSettingsGuide />}
    />
  );
}
