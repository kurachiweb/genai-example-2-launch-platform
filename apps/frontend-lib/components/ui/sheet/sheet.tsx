import { Dialog as SheetPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';

export function Sheet(props: ComponentProps<typeof SheetPrimitive.Root>) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />;
}
