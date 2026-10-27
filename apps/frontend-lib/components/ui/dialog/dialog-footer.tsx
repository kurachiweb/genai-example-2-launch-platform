import { Dialog as DialogPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';

import { cn } from '../../../utilities/class-names.ts';
import { Button } from '../button/button.tsx';

export interface DialogFooterProps extends ComponentProps<'div'> {
  readonly showCloseButton?: boolean;
}

export function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: DialogFooterProps) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        'flex flex-col-reverse gap-2 sm:flex-row sm:justify-end',
        className,
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close asChild>
          <Button variant="outline">閉じる</Button>
        </DialogPrimitive.Close>
      )}
    </div>
  );
}
