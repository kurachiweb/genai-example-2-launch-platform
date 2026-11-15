import { TriangleAlertIcon } from 'lucide-react';

import { SUSPENDED_NOTICE_LABEL } from '../settings/settings-messages.ts';
import { SUSPENDED_EDIT_NOTICE } from './profile-form-messages.ts';

export function ProfileEditSuspendedNotice() {
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
      <p>{SUSPENDED_EDIT_NOTICE}</p>
    </div>
  );
}
