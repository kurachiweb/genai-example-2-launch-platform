import { CalendarIcon, ChevronRightIcon, TrophyIcon } from 'lucide-react';

import { Badge } from '../../../lib/components/ui/badge/badge.tsx';
import { LaunchDateText } from '../product/launch-date-text.tsx';
import {
  BRACKET_LINK_LABEL,
  FINAL_DATE_LABEL,
  WEEK_TOURNAMENT_SECTION_TITLE,
} from './week-tournament-messages.ts';

export interface WeekSectionHeadingProps {
  // 区画の`aria-labelledby`が指す見出しのid
  readonly id: string;
  readonly roundName: string;
  // 週の表記(「2026年第37週(9/7〜9/13)」)
  readonly weekLabel: string;
  // 決勝の実施日(業務日付)。遅れの後は遅らせた後の日
  readonly finalDate: string | null;
  readonly bracketPath: string;
}

export function WeekSectionHeading({
  id,
  roundName,
  weekLabel,
  finalDate,
  bracketPath,
}: WeekSectionHeadingProps) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2 border-b-2 border-primary/20 pb-2">
      <h2
        id={id}
        className="flex flex-wrap items-center gap-2 text-xl font-extrabold tracking-tight sm:text-2xl"
      >
        <TrophyIcon className="size-5 text-gold-strong" aria-hidden="true" />
        {WEEK_TOURNAMENT_SECTION_TITLE}
        <Badge size="lg" className="border-0 bg-silver text-gold-foreground">
          {roundName}
        </Badge>
      </h2>
      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
        <span>{weekLabel}</span>
        {finalDate !== null && (
          <span className="inline-flex items-center gap-1">
            <CalendarIcon className="size-4" aria-hidden="true" />
            {FINAL_DATE_LABEL}
            <LaunchDateText date={finalDate} />
          </span>
        )}
        <a
          href={bracketPath}
          className="inline-flex items-center gap-0.5 font-semibold text-primary underline underline-offset-4"
        >
          {BRACKET_LINK_LABEL}
          <ChevronRightIcon className="size-4" aria-hidden="true" />
        </a>
      </p>
    </div>
  );
}
