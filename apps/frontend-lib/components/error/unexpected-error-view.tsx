import { CircleAlertIcon, RotateCwIcon } from 'lucide-react';
import { type ComponentProps, useId } from 'react';

import { cn } from '../../utilities/class-names.ts';
import {
  CONTACT_LABEL,
  RETRY_GUIDANCE,
  RETRY_LABEL,
  UNEXPECTED_ERROR_TITLE,
} from '../../utilities/messages/state-messages.ts';
import { Button } from '../ui/button/button.tsx';

export interface UnexpectedErrorViewProps extends Omit<
  ComponentProps<'section'>,
  'children'
> {
  readonly onRetry: () => void;
  readonly contactHref: string;
}

export function UnexpectedErrorView({
  onRetry,
  contactHref,
  className,
  ...props
}: UnexpectedErrorViewProps) {
  const headingId = useId();

  return (
    <section
      aria-labelledby={headingId}
      data-slot="unexpected-error-view"
      className={cn(
        'mx-auto flex w-full max-w-xl flex-col items-center px-4 py-24 text-center',
        className,
      )}
      {...props}
    >
      <CircleAlertIcon
        aria-hidden="true"
        className="size-10 text-destructive"
      />
      <div role="alert">
        <h1
          id={headingId}
          className="mt-4 text-2xl font-extrabold tracking-tight"
        >
          {UNEXPECTED_ERROR_TITLE}
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">{RETRY_GUIDANCE}</p>
      </div>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Button type="button" onClick={onRetry}>
          <RotateCwIcon aria-hidden="true" />
          {RETRY_LABEL}
        </Button>
        <Button variant="outline" asChild>
          <a href={contactHref}>{CONTACT_LABEL}</a>
        </Button>
      </div>
    </section>
  );
}
