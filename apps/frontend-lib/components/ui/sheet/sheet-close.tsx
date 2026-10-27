import { Dialog as SheetPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';

export function SheetClose(props: ComponentProps<typeof SheetPrimitive.Close>) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />;
}
