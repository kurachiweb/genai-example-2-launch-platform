import type { ComponentProps } from 'react';

import { cn } from '../../../utilities/class-names.ts';

export function DropdownMenuShortcut({
  className,
  ...props
}: ComponentProps<'span'>) {
  return (
    <span
      data-slot="dropdown-menu-shortcut"
      className={cn(
        'ml-auto text-xs tracking-widest text-muted-foreground',
        className,
      )}
      {...props}
    />
  );
}
