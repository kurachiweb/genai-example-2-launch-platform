import { Dialog as SheetPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';

export function SheetTrigger(
  props: ComponentProps<typeof SheetPrimitive.Trigger>,
) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
}
