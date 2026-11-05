import { TriangleAlertIcon } from 'lucide-react';

import {
  SUSPENDED_CONTACT_NOTICE,
  SUSPENDED_CONTACT_NOTICE_LABEL,
} from './inquiry-contact-messages.ts';

// 停止中の利用者の問い合わせは未ログインの問い合わせとして受け付け、チャットで返信しないため、回答の届け先を送信の前に示す
export function SuspendedContactNotice() {
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
      <p>{SUSPENDED_CONTACT_NOTICE}</p>
    </div>
  );
}
