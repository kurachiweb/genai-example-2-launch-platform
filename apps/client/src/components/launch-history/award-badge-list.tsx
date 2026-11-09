import { useId, useState } from 'react';

import { Tooltip } from '../../../lib/components/ui/tooltip/tooltip.tsx';
import { TooltipContent } from '../../../lib/components/ui/tooltip/tooltip-content.tsx';
import { TooltipTrigger } from '../../../lib/components/ui/tooltip/tooltip-trigger.tsx';
import { cn } from '../../../lib/utilities/class-names.ts';
import type {
  ProductAwardKindView,
  ProductAwardView,
} from '../../graphql/product-launch.ts';
import {
  awardBadgeLabel,
  awardDescriptionOf,
} from './launch-history-messages.ts';

export interface AwardBadgeListProps {
  // 種類ごとにまとめた受賞
  readonly awards: readonly ProductAwardView[];
  readonly className?: string;
}

const KIND_ORDER: Readonly<Record<ProductAwardKindView, number>> =
  Object.freeze({ year: 0, week: 1 });

const BADGE_CLASS_NAME =
  'inline-flex cursor-default items-center rounded-full border border-gold-strong bg-gold px-2.5 py-0.5 text-xs font-bold text-gold-foreground focus-visible:ring-3 focus-visible:ring-ring/50';

function AwardBadge({ award }: { readonly award: ProductAwardView }) {
  const descriptionId = useId();
  const [open, setOpen] = useState(false);
  const description = awardDescriptionOf(award.labels);
  return (
    <li>
      <Tooltip open={open} onOpenChange={setOpen}>
        {/* 開いている間はツールチップが説明になるため、閉じている間だけ同じ文言を説明として結び付け、二重に読ませない */}
        <TooltipTrigger
          asChild
          aria-describedby={open ? undefined : descriptionId}
        >
          <button type="button" translate="no" className={BADGE_CLASS_NAME}>
            {awardBadgeLabel(award.kind, award.count)}
          </button>
        </TooltipTrigger>
        <TooltipContent aria-label={description}>
          {award.labels.map((label) => (
            <span key={label} data-slot="award-label" className="block">
              {label}
            </span>
          ))}
        </TooltipContent>
      </Tooltip>
      {/* 本文としては読み上げさせず、説明の参照先にだけ使う */}
      <span id={descriptionId} hidden>
        {description}
      </span>
    </li>
  );
}

// 受賞の種類ごとに1つのゴールドのバッジを、Yearを先頭に並べる。受賞が無ければ何も描かない
export function AwardBadgeList({ awards, className }: AwardBadgeListProps) {
  if (awards.length === 0) {
    return null;
  }
  const ordered = awards.toSorted(
    (left, right) => KIND_ORDER[left.kind] - KIND_ORDER[right.kind],
  );
  return (
    <ul className={cn('flex flex-wrap gap-1.5', className)}>
      {ordered.map((award) => (
        <AwardBadge key={award.kind} award={award} />
      ))}
    </ul>
  );
}
