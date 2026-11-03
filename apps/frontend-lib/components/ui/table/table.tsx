import { type ComponentProps, useRef } from 'react';

import { cn } from '../../../utilities/class-names.ts';
import { useScrollRegion } from './use-scroll-region.ts';

export function Table({ className, ...props }: ComponentProps<'table'>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { overflowing, label } = useScrollRegion(containerRef);
  return (
    <div
      ref={containerRef}
      data-slot="table-container"
      role={overflowing ? 'region' : undefined}
      aria-label={overflowing ? label : undefined}
      tabIndex={overflowing ? 0 : undefined}
      className="relative w-full overflow-x-auto"
    >
      <table
        data-slot="table"
        className={cn('w-full caption-bottom text-sm', className)}
        {...props}
      />
    </div>
  );
}
