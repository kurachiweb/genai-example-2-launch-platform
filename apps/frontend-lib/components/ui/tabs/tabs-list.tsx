import { Tabs as TabsPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';

import { cn } from '../../../utilities/class-names.ts';
import {
  type TabsListVariant,
  tabsListVariants,
} from './tabs-list-variants.ts';

export interface TabsListProps extends ComponentProps<
  typeof TabsPrimitive.List
> {
  readonly variant?: TabsListVariant;
}

export function TabsList({
  className,
  variant = 'default',
  ...props
}: TabsListProps) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    />
  );
}
