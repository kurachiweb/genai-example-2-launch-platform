import { CalendarIcon, TrophyIcon } from 'lucide-react';

import { Badge } from '../../../lib/components/ui/badge/badge.tsx';
import { LaunchDateText } from '../product/launch-date-text.tsx';
import { TournamentBracketLink } from './tournament-bracket-link.tsx';
import { FINAL_DATE_LABEL } from './tournament-copy.ts';

export interface TournamentSectionHeadingProps {
  // 区画の`aria-labelledby`が指す見出しのid
  readonly id: string;
  // 区画の名前(「Product of the Weekトーナメント」など)
  readonly title: string;
  readonly roundName: string;
  // 期間の表記(週の「2026年第37週(9/7〜9/13)」や対象年など)
  readonly periodLabel: string;
  // 決勝の実施日(業務日付)。遅れの後は遅らせた後の日
  readonly finalDate: string | null;
  readonly bracketPath: string;
}

export function TournamentSectionHeading({
  id,
  title,
  roundName,
  periodLabel,
  finalDate,
  bracketPath,
}: TournamentSectionHeadingProps) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2 border-b-2 border-primary/20 pb-2">
      <h2
        id={id}
        className="flex flex-wrap items-center gap-2 text-xl font-extrabold tracking-tight sm:text-2xl"
      >
        <TrophyIcon className="size-5 text-gold-strong" aria-hidden="true" />
        {title}
        <Badge size="lg" className="border-0 bg-silver text-gold-foreground">
          {roundName}
        </Badge>
      </h2>
      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
        <span>{periodLabel}</span>
        {finalDate !== null && (
          <span className="inline-flex items-center gap-1">
            <CalendarIcon className="size-4" aria-hidden="true" />
            {FINAL_DATE_LABEL}
            <LaunchDateText date={finalDate} />
          </span>
        )}
        <TournamentBracketLink href={bracketPath} />
      </p>
    </div>
  );
}
