import { MegaphoneIcon } from 'lucide-react';

import { PathLink } from '../../../lib/components/navigation/path-link.tsx';
import { cn } from '../../../lib/utilities/class-names.ts';
import {
  SPONSORSHIP_APPLY_HREF,
  SPONSORSHIP_APPLY_LINK_LABEL,
} from './sponsorship-messages.ts';

export interface SponsorshipApplyLinkProps {
  readonly className?: string;
}

export function SponsorshipApplyLink({ className }: SponsorshipApplyLinkProps) {
  return (
    <PathLink
      href={SPONSORSHIP_APPLY_HREF}
      className={cn(
        'inline-flex min-h-10 items-center gap-2 rounded-lg border border-dashed border-border bg-card px-3 py-2 text-sm font-medium text-foreground no-underline hover:bg-accent',
        className,
      )}
    >
      <MegaphoneIcon aria-hidden="true" className="size-4 shrink-0" />
      {SPONSORSHIP_APPLY_LINK_LABEL}
    </PathLink>
  );
}
