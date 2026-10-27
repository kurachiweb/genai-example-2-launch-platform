import type { ComponentProps, ReactNode } from 'react';

import { cn } from '../../utilities/class-names.ts';
import { LOADING_LABEL } from '../../utilities/messages/state-messages.ts';
import { Skeleton } from '../ui/skeleton/skeleton.tsx';

export interface LoadingSkeletonProps extends Omit<
  ComponentProps<'div'>,
  'role' | 'children'
> {
  readonly label?: string;
  readonly children?: ReactNode;
}

const DEFAULT_SKELETON = (
  <div className="flex flex-col gap-3">
    <Skeleton className="h-5 w-1/3" />
    <Skeleton className="h-4 w-full" />
    <Skeleton className="h-4 w-3/4" />
  </div>
);

// 視差効果を減らす設定ではスケルトンの明滅が止まるため、読み込み中であることは動きではなく状態の領域の文言で伝える
export function LoadingSkeleton({
  label = LOADING_LABEL,
  children = DEFAULT_SKELETON,
  className,
  ...props
}: LoadingSkeletonProps) {
  return (
    <div
      role="status"
      data-slot="loading-skeleton"
      className={cn('w-full', className)}
      {...props}
    >
      <span className="sr-only">{label}</span>
      <div aria-hidden="true">{children}</div>
    </div>
  );
}
