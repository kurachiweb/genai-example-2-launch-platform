import { XIcon } from 'lucide-react';
import { Dialog as SheetPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';

import { cn } from '../../../utilities/class-names.ts';
import {
  type SheetSide,
  sheetContentVariants,
} from './sheet-content-variants.ts';
import { SheetOverlay } from './sheet-overlay.tsx';
import { SheetPortal } from './sheet-portal.tsx';

export interface SheetContentProps extends ComponentProps<
  typeof SheetPrimitive.Content
> {
  readonly side?: SheetSide;
  readonly showCloseButton?: boolean;
}

export function SheetContent({
  className,
  children,
  side = 'right',
  showCloseButton = true,
  ...props
}: SheetContentProps) {
  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Content
        data-slot="sheet-content"
        className={cn(sheetContentVariants({ side, className }))}
        {...props}
      >
        {children}
        {showCloseButton && (
          <SheetPrimitive.Close
            data-slot="sheet-close"
            className="absolute top-4 right-4 rounded-xs opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-secondary"
          >
            <XIcon className="size-4" />
            <span className="sr-only">閉じる</span>
          </SheetPrimitive.Close>
        )}
      </SheetPrimitive.Content>
    </SheetPortal>
  );
}
