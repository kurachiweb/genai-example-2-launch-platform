import type { ComponentProps } from 'react';

import { cn } from '../../../utilities/class-names.ts';

export function PopoverHeader({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="popover-header"
      className={cn('flex flex-col gap-1 text-sm', className)}
      {...props}
    />
  );
}
