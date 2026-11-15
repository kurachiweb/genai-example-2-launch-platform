import { TriangleAlertIcon } from 'lucide-react';

import { INLINE_LINK_CLASS_NAME } from '../../../lib/components/navigation/inline-link-class.ts';
import { PathLink } from '../../../lib/components/navigation/path-link.tsx';
import { CONTACT_HREF } from '../layout/site-links.ts';
import {
  SUSPENDED_CHAT_NOTICE_LINK,
  SUSPENDED_CHAT_NOTICE_PREFIX,
  SUSPENDED_CHAT_NOTICE_SUFFIX,
} from './inquiry-chat-messages.ts';
import { SUSPENDED_CONTACT_NOTICE_LABEL } from './inquiry-contact-messages.ts';

// 停止中の利用者はチャットへ送信できないが、未ログインの問い合わせとしてフォームから連絡できるため、送信欄の代わりにその導線を示す
export function SuspendedChatNotice() {
  return (
    <div
      role="note"
      aria-label={SUSPENDED_CONTACT_NOTICE_LABEL}
      className="flex gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm"
    >
      <TriangleAlertIcon
        aria-hidden="true"
        className="mt-0.5 size-4 shrink-0 text-destructive"
      />
      <p>
        {SUSPENDED_CHAT_NOTICE_PREFIX}
        <PathLink href={CONTACT_HREF} className={INLINE_LINK_CLASS_NAME}>
          {SUSPENDED_CHAT_NOTICE_LINK}
        </PathLink>
        {SUSPENDED_CHAT_NOTICE_SUFFIX}
      </p>
    </div>
  );
}
