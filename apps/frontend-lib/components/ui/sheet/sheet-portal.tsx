import { Dialog as SheetPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';

export function SheetPortal(
  props: ComponentProps<typeof SheetPrimitive.Portal>,
) {
  return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />;
}
