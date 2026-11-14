import { MailWarningIcon } from 'lucide-react';

import { Button } from '../../../lib/components/ui/button/button.tsx';
import {
  RESEND_VERIFICATION_LABEL,
  VERIFY_EMAIL_BANNER_MESSAGE,
} from '../auth/account-messages.ts';
import { useResendVerification } from '../auth/use-resend-verification.ts';
import { useViewer } from '../auth/use-viewer.ts';

export function VerifyEmailBanner() {
  const viewer = useViewer();
  const { resend, pending } = useResendVerification();

  if (viewer === null || viewer.emailVerified) {
    return null;
  }

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
        {/* aria-disabledは押下を止めないため、送信中の押下は再送の処理が無視する */}
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="bg-card"
          aria-busy={pending ? true : undefined}
          aria-disabled={pending ? true : undefined}
          onClick={resend}
        >
          {RESEND_VERIFICATION_LABEL}
        </Button>
      </div>
    </div>
  );
}
