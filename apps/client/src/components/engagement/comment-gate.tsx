import { Link, useLocation } from '@tanstack/react-router';
import { MailWarningIcon, MessageSquareIcon } from 'lucide-react';

import { Button } from '../../../lib/components/ui/button/button.tsx';
import { ClientEngagementResendVerificationEmailDocument } from '../../graphql/generated/graphql.ts';
import { RESEND_VERIFICATION_LABEL } from '../auth/account-messages.ts';
import { useResendVerification } from '../auth/use-resend-verification.ts';
import type { EngagementViewerKind } from './engagement-viewer.ts';
import {
  COMMENT_EMAIL_UNVERIFIED_REASON,
  COMMENT_GUEST_NOTICE,
  COMMENT_LOGIN_LINK_LABEL,
} from './comment-messages.ts';

export interface CommentGateProps {
  readonly kind: Extract<EngagementViewerKind, 'guest' | 'unverified'>;
}

const NOTICE_TEXT_CLASS = 'min-w-0 flex-1';

function UnverifiedCommentGate() {
  const { resend, pending } = useResendVerification(
    ClientEngagementResendVerificationEmailDocument,
  );
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-warning/50 bg-warning/10 px-4 py-3 text-sm">
      <MailWarningIcon
        aria-hidden="true"
        className="size-5 shrink-0 text-warning-strong"
      />
      <p className={NOTICE_TEXT_CLASS}>{COMMENT_EMAIL_UNVERIFIED_REASON}</p>
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

function GuestCommentGate() {
  const returnTo = useLocation({
    select: ({ pathname, searchStr }) => `${pathname}${searchStr}`,
  });
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-border bg-card px-4 py-3 text-sm">
      <MessageSquareIcon
        aria-hidden="true"
        className="size-5 shrink-0 text-muted-foreground"
      />
      <p className={NOTICE_TEXT_CLASS}>{COMMENT_GUEST_NOTICE}</p>
      <Button asChild size="sm">
        <Link to="/auth/login" search={{ redirect: returnTo }}>
          {COMMENT_LOGIN_LINK_LABEL}
        </Link>
      </Button>
    </div>
  );
}

// コメントを投稿できない閲覧者に、投稿欄の代わりに理由と次の行動を示す
export function CommentGate({ kind }: CommentGateProps) {
  return kind === 'unverified' ? (
    <UnverifiedCommentGate />
  ) : (
    <GuestCommentGate />
  );
}
