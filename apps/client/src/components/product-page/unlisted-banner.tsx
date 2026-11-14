import { EyeOffIcon } from 'lucide-react';

import {
  UNLISTED_NOTICE_BODY,
  UNLISTED_NOTICE_LEAD,
} from './unlisted-banner-messages.ts';

export interface UnlistedBannerProps {
  readonly listed: boolean;
  readonly viewerIsOwner: boolean;
}

export function UnlistedBanner({ listed, viewerIsOwner }: UnlistedBannerProps) {
  if (listed || !viewerIsOwner) {
    return null;
  }
  return (
    <div
      role="note"
      className="flex items-start gap-3 rounded-xl border border-primary/30 bg-primary/8 px-4 py-3 text-sm"
    >
      <EyeOffIcon
        aria-hidden="true"
        className="mt-0.5 size-5 shrink-0 text-primary"
      />
      <p>
        <strong className="font-bold">{UNLISTED_NOTICE_LEAD}</strong>
        {UNLISTED_NOTICE_BODY}
      </p>
    </div>
  );
}
