import { Dialog as DialogPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';

export function DialogClose(
  props: ComponentProps<typeof DialogPrimitive.Close>,
) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}
