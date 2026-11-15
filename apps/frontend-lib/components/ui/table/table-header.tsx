import type { ComponentProps } from 'react';

import { cn } from '../../../utilities/class-names.ts';

export function TableHeader({ className, ...props }: ComponentProps<'thead'>) {
  return (
    <thead
      data-slot="table-header"
      className={cn('[&_tr]:border-b', className)}
      {...props}
    />
  );
}
