import type { ComponentProps } from 'react';

import { cn } from '../../../utilities/class-names.ts';

export function PopoverDescription({
  className,
  ...props
}: ComponentProps<'p'>) {
  return (
    <p
      data-slot="popover-description"
      className={cn('text-muted-foreground', className)}
      {...props}
    />
  );
}
