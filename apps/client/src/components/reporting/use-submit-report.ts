import { useMutation } from '@tanstack/react-query';

import {
  type TurnstileTokenController,
  useTurnstileToken,
} from '../../../lib/components/bot-protection/use-turnstile-token.ts';
import { notify } from '../../../lib/components/feedback/notify.ts';
import { sendWithTurnstile } from '../../../lib/utilities/bot-protection/send-with-turnstile.ts';
import { errorMessageOf } from '../../../lib/utilities/graphql/graphql-result.ts';
import { CLIENT_PROFILE } from '../../composition/app-profile.ts';
import {
  type ReportSubmission,
  submitReportMutationOptions,
  toSubmitReportVariables,
} from '../../graphql/reporting.ts';
import { REPORT_MESSAGES } from './report-messages.ts';

export interface SubmitReport {
  readonly turnstile: TurnstileTokenController;
  // 受け付けられると通知して解決し、拒否・失敗はそのまま投げる(欄の詳細はフォームが欄に示す)
  readonly submit: (submission: ReportSubmission) => Promise<void>;
}

export function useSubmitReport(): SubmitReport {
  const turnstile = useTurnstileToken();
  const mutation = useMutation(submitReportMutationOptions());

  return {
    turnstile,
    submit: async (submission) => {
      await sendWithTurnstile(turnstile, (turnstileToken) =>
        mutation.mutateAsync({
          variables: toSubmitReportVariables(submission),
          turnstileToken,
        }),
      );
      notify.success(REPORT_MESSAGES.accepted);
    },
  };
}

// サーバーの文言規則の文言をそのまま示し、エラーコードを持たない想定外の失敗だけ共通の文言にする
export const reportSubmitErrorMessageOf = (error: unknown): string =>
  errorMessageOf(error, CLIENT_PROFILE.contactAvailable);
