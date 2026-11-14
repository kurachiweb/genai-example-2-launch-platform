import { CircleAlertIcon, RotateCwIcon } from 'lucide-react';
import type { ComponentProps } from 'react';

import { cn } from '../../utilities/class-names.ts';
import {
  CONTACT_LABEL,
  RETRY_LABEL,
} from '../../utilities/messages/state-messages.ts';
import { Button } from '../ui/button/button.tsx';

export interface ErrorStateProps extends Omit<
  ComponentProps<'div'>,
  'children'
> {
  readonly message: string;
  readonly onRetry: () => void;
  readonly contactHref?: string;
}

export function ErrorState({
  message,
  onRetry,
  contactHref,
  className,
  ...props
}: ErrorStateProps) {
  return (
    <div
      data-slot="error-state"
      className={cn(
        'flex flex-col items-center rounded-2xl border border-border bg-card px-6 py-14 text-center text-card-foreground shadow-sm',
        className,
      )}
      {...props}
    >
      <CircleAlertIcon
        aria-hidden="true"
        className="size-10 text-destructive"
      />
      <p role="alert" className="mt-4 max-w-md font-bold">
        {message}
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Button type="button" onClick={onRetry}>
          <RotateCwIcon aria-hidden="true" />
          {RETRY_LABEL}
        </Button>
        {contactHref === undefined ? null : (
          <Button variant="outline" asChild>
            <a href={contactHref}>{CONTACT_LABEL}</a>
          </Button>
        )}
      </div>
    </div>
  );
}
