import { RotateCwIcon } from 'lucide-react';
import type { ComponentProps } from 'react';

import { cn } from '../../utilities/class-names.ts';
import { RETRY_LABEL } from '../../utilities/messages/state-messages.ts';
import { Button } from '../ui/button/button.tsx';

export interface PartialErrorStateProps extends Omit<
  ComponentProps<'div'>,
  'children'
> {
  readonly message: string;
  readonly onRetry: () => void;
}

export function PartialErrorState({
  message,
  onRetry,
  className,
  ...props
}: PartialErrorStateProps) {
  return (
    <div
      data-slot="partial-error-state"
      className={cn(
        'flex flex-wrap items-center gap-3 rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm',
        className,
      )}
      {...props}
    >
      <p role="alert" className="min-w-0 flex-1">
        {message}
      </p>
      <Button type="button" size="sm" variant="outline" onClick={onRetry}>
        <RotateCwIcon aria-hidden="true" />
        {RETRY_LABEL}
      </Button>
    </div>
  );
}
