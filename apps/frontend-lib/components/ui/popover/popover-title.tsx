import type { ComponentProps } from 'react';

import { cn } from '../../../utilities/class-names.ts';

export function PopoverTitle({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="popover-title"
      className={cn('font-medium', className)}
      {...props}
    />
  );
}
