import { MailWarningIcon } from 'lucide-react';

import { Button } from '../../../lib/components/ui/button/button.tsx';
import {
  RESEND_VERIFICATION_LABEL,
  VERIFY_EMAIL_PAGE_TITLE,
} from '../auth/account-messages.ts';
import { useResendVerification } from '../auth/use-resend-verification.ts';
import { EMAIL_VERIFICATION_REQUIRED_NOTICE } from './product-form-messages.ts';

// 登録にはメールアドレスの確認が要る旨と、画面上部の帯と同じ確認メールの再送の操作
export function ProductEmailVerificationNotice() {
  const { resend, pending } = useResendVerification();

  return (
    <div
      role="note"
      aria-label={VERIFY_EMAIL_PAGE_TITLE}
      className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-2xl border border-warning/50 bg-warning/15 px-4 py-3.5 sm:px-5"
    >
      <MailWarningIcon
        aria-hidden="true"
        className="size-6 shrink-0 text-warning-strong"
      />
      <p className="min-w-0 flex-1 text-sm leading-relaxed">
        {EMAIL_VERIFICATION_REQUIRED_NOTICE}
      </p>
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
  );
}
