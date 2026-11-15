import { Select as SelectPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';

export function Select(props: ComponentProps<typeof SelectPrimitive.Root>) {
  return <SelectPrimitive.Root data-slot="select" {...props} />;
}
