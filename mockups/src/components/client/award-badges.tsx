import { TrophyIcon } from 'lucide-react';

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '#/components/ui/tooltip';

// 受賞した週(表記規則の「2026年第37週(9/7〜9/13)」)または年をlabelに持つ
export type AwardLabel = { kind: 'week' | 'year'; label: string };

type Props = { awards: AwardLabel[] };

const TITLES: Record<AwardLabel['kind'], string> = {
  year: 'Product of the Year',
  week: 'Product of the Week',
};

// 賞の種類ごとに1つ(Yearを先頭)にまとめ、受賞した週・年はツールチップで示す
export function AwardBadges({ awards }: Props) {
  const groups = (['year', 'week'] as const)
    .map((kind) => ({
      kind,
      labels: awards
        .filter((award) => award.kind === kind)
        .map((award) => award.label),
    }))
    .filter((group) => group.labels.length > 0);

  return groups.map(({ kind, labels }) => (
    <Tooltip key={kind}>
      <TooltipTrigger asChild>
        <button
          type="button"
          translate="no"
          className="gold-gradient relative z-10 inline-flex cursor-default items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold text-gold-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <TrophyIcon className="size-3.5" aria-hidden="true" />
          {TITLES[kind]}
          {labels.length > 1 && (
            <>
              <span aria-hidden="true" className="tabular-nums">
                ×{labels.length}
              </span>
              <span className="sr-only">{labels.length}回受賞</span>
            </>
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-72">
        {labels.map((label) => (
          <span key={label} className="block">
            {label}
          </span>
        ))}
      </TooltipContent>
    </Tooltip>
  ));
}
