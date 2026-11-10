import type { ComponentProps } from 'react';

import { cn } from '../../../utilities/class-names.ts';

export function CardTitle({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-title"
      className={cn('leading-none font-semibold', className)}
      {...props}
    />
  );
}
