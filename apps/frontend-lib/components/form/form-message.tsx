import { CircleAlertIcon } from 'lucide-react';
import type { ComponentProps } from 'react';

import { cn } from '../../utilities/class-names.ts';

export function FormMessage({
  className,
  children,
  ...props
}: ComponentProps<'p'>) {
  return (
    <p
      data-slot="form-message"
      className={cn(
        'flex items-start gap-1.5 text-sm text-destructive',
        className,
      )}
      {...props}
    >
      <CircleAlertIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </p>
  );
}
