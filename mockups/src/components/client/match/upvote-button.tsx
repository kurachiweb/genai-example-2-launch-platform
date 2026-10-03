import { ChevronUpIcon } from 'lucide-react';

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '#/components/ui/tooltip';
import { cn } from '#/lib/utils';

type Props = {
  count: number;
  pressed: boolean;
  disabledReason: string | null;
  productName: string;
  variant: 'card' | 'final';
  onClick: () => void;
};

// 決勝は横並びになる中間幅(640〜1200px)でプロダクト名の表示幅を確保するため、カードと同じ大きさに縮める
const SIZE_CLASSES = {
  card: {
    button: 'h-16 w-16',
    icon: 'size-5',
    count: 'text-xl',
  },
  final: {
    button:
      'rounded-2xl h-16 w-16 @[768px]:rounded-xl @[1200px]:h-24 @[1200px]:w-24 @[1200px]:rounded-2xl',
    icon: 'size-5 @[1200px]:size-8',
    count: 'text-xl @[1200px]:text-4xl',
  },
} as const;

export function UpvoteButton({
  count,
  pressed,
  disabledReason,
  productName,
  variant,
  onClick,
}: Props) {
  const sizeClasses = SIZE_CLASSES[variant];
  const label = pressed
    ? `${productName}へのUpvoteを取り消す`
    : `${productName}にUpvote`;
  const button = (
    <button
      type="button"
      aria-pressed={pressed}
      aria-label={label}
      aria-disabled={disabledReason != null}
      onClick={disabledReason ? undefined : onClick}
      className={cn(
        'group flex shrink-0 flex-col items-center justify-center rounded-xl border-2 transition-[background-color,border-color,transform,box-shadow] focus-visible:ring-3 focus-visible:ring-ring/60 focus-visible:outline-none active:scale-95',
        sizeClasses.button,
        pressed
          ? 'border-primary bg-primary text-primary-foreground shadow-md shadow-primary/30'
          : 'border-primary/50 bg-card text-primary hover:border-primary hover:bg-primary/10',
        disabledReason &&
          'cursor-not-allowed opacity-60 hover:bg-card active:scale-100',
      )}
    >
      <ChevronUpIcon
        aria-hidden="true"
        className={cn(
          'transition-transform group-hover:-translate-y-0.5',
          sizeClasses.icon,
        )}
        strokeWidth={3}
      />
      <span
        key={count}
        className={cn(
          'scoreboard-digits count-roll-in leading-none',
          sizeClasses.count,
        )}
      >
        {count.toLocaleString()}
      </span>
    </button>
  );

  if (!disabledReason) return button;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="inline-flex rounded-xl">
          {button}
        </span>
      </TooltipTrigger>
      <TooltipContent>{disabledReason}</TooltipContent>
    </Tooltip>
  );
}
