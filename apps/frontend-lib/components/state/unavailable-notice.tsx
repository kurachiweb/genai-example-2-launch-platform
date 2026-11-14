import { TriangleAlertIcon } from 'lucide-react';
import type { ComponentProps } from 'react';

import { cn } from '../../utilities/class-names.ts';
import { UNAVAILABLE_TITLE } from '../../utilities/messages/state-messages.ts';

export interface UnavailableNoticeProps extends Omit<
  ComponentProps<'div'>,
  'role' | 'children'
> {
  readonly reason: string;
}

export function UnavailableNotice({
  reason,
  className,
  ...props
}: UnavailableNoticeProps) {
  return (
    <div
      role="status"
      data-slot="unavailable-notice"
      className={cn(
        'flex gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm',
        className,
      )}
      {...props}
    >
      <TriangleAlertIcon
        aria-hidden="true"
        className="mt-0.5 size-4 shrink-0 text-destructive"
      />
      <p>
        <strong className="block font-bold">{UNAVAILABLE_TITLE}</strong>
        {reason}
      </p>
    </div>
  );
}
