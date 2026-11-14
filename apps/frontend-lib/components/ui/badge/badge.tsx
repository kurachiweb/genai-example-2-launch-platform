import { Slot } from 'radix-ui';
import type { ComponentProps } from 'react';

import { cn } from '../../../utilities/class-names.ts';
import {
  type BadgeSize,
  type BadgeVariant,
  badgeVariants,
} from './badge-variants.ts';

export interface BadgeProps extends ComponentProps<'span'> {
  readonly variant?: BadgeVariant;
  readonly size?: BadgeSize;
  readonly asChild?: boolean;
}

export function Badge({
  className,
  variant = 'default',
  size = 'default',
  asChild = false,
  ...props
}: BadgeProps) {
  const Comp = asChild ? Slot.Root : 'span';

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      data-size={size}
      className={cn(badgeVariants({ variant, size }), className)}
      {...props}
    />
  );
}
