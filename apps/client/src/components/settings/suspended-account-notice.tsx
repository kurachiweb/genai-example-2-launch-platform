import { TriangleAlertIcon } from 'lucide-react';

import { INLINE_LINK_CLASS_NAME } from '../../../lib/components/navigation/inline-link-class.ts';
import { CONTACT_HREF } from '../layout/site-links.ts';
import { PathLink } from '../../../lib/components/navigation/path-link.tsx';
import {
  CONTACT_LINK_LABEL,
  SUSPENDED_NOTICE_LABEL,
  SUSPENDED_NOTICE_PREFIX,
  SUSPENDED_NOTICE_SUFFIX,
} from './settings-messages.ts';

export interface SuspendedAccountNoticeProps {
  // ページごとに、停止中に行えない操作と行える操作を示す文
  readonly lead: string;
}

// 停止中の利用者はログインできず、セッションが切れた後は設定ページから退会できないため、問い合わせによる退会の依頼の導線を示す
export function SuspendedAccountNotice({ lead }: SuspendedAccountNoticeProps) {
  return (
    <div
      role="note"
      aria-label={SUSPENDED_NOTICE_LABEL}
      className="flex gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm"
    >
      <TriangleAlertIcon
        aria-hidden="true"
        className="mt-0.5 size-4 shrink-0 text-destructive"
      />
      <p>
        {lead}
        {SUSPENDED_NOTICE_PREFIX}
        <PathLink href={CONTACT_HREF} className={INLINE_LINK_CLASS_NAME}>
          {CONTACT_LINK_LABEL}
        </PathLink>
        {SUSPENDED_NOTICE_SUFFIX}
      </p>
    </div>
  );
}
