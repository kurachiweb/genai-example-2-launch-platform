import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MailWarningIcon } from 'lucide-react';

import { notify } from '../../../lib/components/feedback/notify.ts';
import { Button } from '../../../lib/components/ui/button/button.tsx';
import { graphqlMutationOptions } from '../../../lib/start/graphql/graphql-query-options.ts';
import { errorMessageOf } from '../../../lib/utilities/graphql/graphql-result.ts';
import { CLIENT_PROFILE } from '../../composition/app-profile.ts';
import { ClientResendVerificationEmailDocument } from '../../graphql/generated/graphql.ts';
import { viewerQueryOptions } from '../../graphql/viewer.ts';
import {
  EMAIL_ALREADY_VERIFIED_MESSAGE,
  RESEND_VERIFICATION_LABEL,
  VERIFICATION_RESENT_MESSAGE,
  VERIFY_EMAIL_BANNER_MESSAGE,
} from '../auth/account-messages.ts';
import { useViewer } from '../auth/use-viewer.ts';

export function VerifyEmailBanner() {
  const viewer = useViewer();
  const queryClient = useQueryClient();
  const resend = useMutation({
    ...graphqlMutationOptions(ClientResendVerificationEmailDocument),
    onSuccess: async ({ resendVerificationEmail }) => {
      if (resendVerificationEmail === 'SENT') {
        notify.success(VERIFICATION_RESENT_MESSAGE);
        return;
      }
      notify.info(EMAIL_ALREADY_VERIFIED_MESSAGE);
      await queryClient.invalidateQueries({
        queryKey: viewerQueryOptions().queryKey,
      });
    },
    onError: (error) => {
      notify.error(errorMessageOf(error, CLIENT_PROFILE.contactAvailable));
    },
  });

  if (viewer === null || viewer.emailVerified) {
    return null;
  }

  // aria-disabledは押下を止めないため、送信中の押下はここで無視する
  const handleResend = (): void => {
    if (!resend.isPending) {
      resend.mutate({ variables: {} });
    }
  };

  return (
    <div
      role="status"
      className="border-b border-warning/50 bg-warning/15 text-foreground"
    >
      <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 text-sm">
        <MailWarningIcon
          aria-hidden="true"
          className="size-5 shrink-0 text-warning-strong"
        />
        <p className="min-w-0 flex-1">{VERIFY_EMAIL_BANNER_MESSAGE}</p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="bg-card"
          aria-busy={resend.isPending ? true : undefined}
          aria-disabled={resend.isPending ? true : undefined}
          onClick={handleResend}
        >
          {RESEND_VERIFICATION_LABEL}
        </Button>
      </div>
    </div>
  );
}
