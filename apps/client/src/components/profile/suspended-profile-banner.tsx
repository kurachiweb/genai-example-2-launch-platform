import { BanIcon } from 'lucide-react';

import { PathLink } from '../../../lib/components/navigation/path-link.tsx';
import { Button } from '../../../lib/components/ui/button/button.tsx';
import { CONTACT_HREF } from '../layout/site-links.ts';
import {
  SUSPENDED_PROFILE_CONTACT_LABEL,
  SUSPENDED_PROFILE_NOTICE_LABEL,
  SUSPENDED_PROFILE_NOTICE_MESSAGE,
} from './profile-messages.ts';

// 停止中の本人にだけ出す。他の閲覧者には同じプロフィールが404になるため、この帯は本人以外には届かない
export function SuspendedProfileBanner() {
  return (
    <div
      role="note"
      aria-label={SUSPENDED_PROFILE_NOTICE_LABEL}
      className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-3 rounded-2xl border border-destructive/40 bg-destructive/5 px-4 py-3.5 sm:px-5"
    >
      <BanIcon
        aria-hidden="true"
        className="size-6 shrink-0 text-destructive"
      />
      <p className="min-w-0 flex-1 text-sm leading-relaxed">
        {SUSPENDED_PROFILE_NOTICE_MESSAGE}
      </p>
      <Button size="sm" variant="outline" className="bg-card" asChild>
        <PathLink href={CONTACT_HREF}>
          {SUSPENDED_PROFILE_CONTACT_LABEL}
        </PathLink>
      </Button>
    </div>
  );
}
