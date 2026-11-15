import { Select as SelectPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';

export function SelectGroup(
  props: ComponentProps<typeof SelectPrimitive.Group>,
) {
  return <SelectPrimitive.Group data-slot="select-group" {...props} />;
}
