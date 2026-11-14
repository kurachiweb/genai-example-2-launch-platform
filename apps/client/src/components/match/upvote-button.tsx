import { ChevronUpIcon } from 'lucide-react';
import { useId, useState } from 'react';

import { NumberText } from '../../../lib/components/datetime/number-text.tsx';
import { Tooltip } from '../../../lib/components/ui/tooltip/tooltip.tsx';
import { TooltipContent } from '../../../lib/components/ui/tooltip/tooltip-content.tsx';
import { TooltipTrigger } from '../../../lib/components/ui/tooltip/tooltip-trigger.tsx';
import { cn } from '../../../lib/utilities/class-names.ts';
import {
  cancelUpvoteLabel,
  upvoteLabel,
  VOTE_UNIT,
} from './match-card-messages.ts';

export interface UpvoteButtonProps {
  readonly productName: string;
  readonly count: number;
  readonly pressed: boolean;
  // 送信中、またはbot対策のトークンを待つ間
  readonly pending?: boolean;
  // 押せない理由。nullなら押せる
  readonly disabledReason: string | null;
  readonly onClick: () => void;
  readonly className?: string;
}

export function UpvoteButton({
  productName,
  count,
  pressed,
  pending = false,
  disabledReason,
  onClick,
  className,
}: UpvoteButtonProps) {
  const reasonId = useId();
  const [open, setOpen] = useState(false);
  const isDisabled = disabledReason !== null;
  const label = pressed
    ? cancelUpvoteLabel(productName)
    : upvoteLabel(productName);
  const isInactive = isDisabled || pending;
  const handleClick = () => {
    if (!isInactive) {
      onClick();
    }
  };

  // 理由をツールチップで示すため、Tabの停止位置とポインターの事象を残すdisabledではなくaria-disabledで押せないことを伝え、押下は受け側で無視する
  const button = (
    <button
      type="button"
      aria-pressed={pressed}
      aria-disabled={isInactive ? true : undefined}
      aria-busy={pending ? true : undefined}
      onClick={handleClick}
      className={cn(
        'group flex size-16 shrink-0 flex-col items-center justify-center rounded-xl border-2 transition-[background-color,border-color,transform,box-shadow] focus-visible:ring-3 focus-visible:ring-ring/60 focus-visible:outline-none',
        pressed
          ? 'border-primary bg-primary text-primary-foreground shadow-md shadow-primary/30'
          : 'border-primary/60 bg-card text-primary',
        isInactive
          ? 'cursor-not-allowed opacity-60'
          : cn(
              'active:scale-95',
              !pressed && 'hover:border-primary hover:bg-primary/10',
            ),
        className,
      )}
    >
      <ChevronUpIcon
        aria-hidden="true"
        strokeWidth={3}
        className={cn(
          'size-5',
          !isInactive && 'transition-transform group-hover:-translate-y-0.5',
        )}
      />
      {/* 見えているUpvote数を名前に含め、名前は「<名称>にUpvote 12票」の形で読ませる */}
      <span className="sr-only">{`${label} `}</span>
      <span className="text-xl leading-none font-extrabold tabular-nums">
        <NumberText value={count} />
        <span className="sr-only">{VOTE_UNIT}</span>
      </span>
    </button>
  );

  if (!isDisabled) {
    return button;
  }

  return (
    <>
      <Tooltip open={open} onOpenChange={setOpen}>
        <TooltipTrigger asChild aria-describedby={open ? undefined : reasonId}>
          {button}
        </TooltipTrigger>
        <TooltipContent>{disabledReason}</TooltipContent>
      </Tooltip>
      {/* 開いている間はツールチップが説明になるため、閉じている間だけ同じ文言を説明として結び付け、二重に読ませない */}
      <span id={reasonId} hidden>
        {disabledReason}
      </span>
    </>
  );
}
