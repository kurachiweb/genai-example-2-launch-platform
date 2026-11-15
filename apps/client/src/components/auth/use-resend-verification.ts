import { useMutation, useQueryClient } from '@tanstack/react-query';

import { notify } from '../../../lib/components/feedback/notify.ts';
import { graphqlMutationOptions } from '../../../lib/start/graphql/graphql-query-options.ts';
import { errorMessageOf } from '../../../lib/utilities/graphql/graphql-result.ts';
import { CLIENT_PROFILE } from '../../composition/app-profile.ts';
import { ClientResendVerificationEmailDocument } from '../../graphql/generated/graphql.ts';
import { viewerQueryOptions } from '../../graphql/viewer.ts';
import {
  EMAIL_ALREADY_VERIFIED_MESSAGE,
  VERIFICATION_RESENT_MESSAGE,
} from './account-messages.ts';

export interface ResendVerification {
  // 送信中の押下は無視する
  readonly resend: () => void;
  readonly pending: boolean;
}

// 確認メールの再送の結果をトーストで示す。既に確認済みなら、確認の状態を画面へ反映するためログイン中の利用者を取り直す
export function useResendVerification(): ResendVerification {
  const queryClient = useQueryClient();
  const mutation = useMutation({
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

  return {
    resend: () => {
      if (!mutation.isPending) {
        mutation.mutate({ variables: {} });
      }
    },
    pending: mutation.isPending,
  };
}
