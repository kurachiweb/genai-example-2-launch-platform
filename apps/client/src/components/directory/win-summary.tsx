import { TrophyIcon } from 'lucide-react';

import { useDisplayPreferences } from '../../../lib/components/datetime/use-display-preferences.ts';
import { Badge } from '../../../lib/components/ui/badge/badge.tsx';
import { cn } from '../../../lib/utilities/class-names.ts';
import { formatNumber } from '../../../lib/utilities/number/number-format.ts';
import { BYE_BADGE_LABEL } from '../match/bye-messages.ts';
import { VOTE_UNIT } from '../match/match-card-messages.ts';
import { LaunchDateText } from '../product/launch-date-text.tsx';
import type { DirectoryWinData } from './directory-item-types.ts';
import {
  NO_OPPONENT_REASON,
  QUALIFIER_WIN_HEADING,
  SETTLED_VOTES_PREFIX,
  UPVOTE_COUNT_PREFIX,
} from './directory-item-messages.ts';

export interface WinSummaryProps {
  readonly win: DirectoryWinData;
}

interface VoteCountProps {
  readonly count: number;
  readonly className: string;
}

function VoteCount({ count, className }: VoteCountProps) {
  const preferences = useDisplayPreferences();
  return (
    <>
      <span className="sr-only">{UPVOTE_COUNT_PREFIX}</span>
      <span className={cn('text-foreground tabular-nums', className)}>
        {formatNumber(count, preferences)}
      </span>
      {VOTE_UNIT}
    </>
  );
}

function ByeBadge() {
  return (
    <Badge className="border-0 bg-gold font-bold text-gold-foreground">
      <TrophyIcon aria-hidden="true" />
      {BYE_BADGE_LABEL}
    </Badge>
  );
}

function WinResult({ win }: WinSummaryProps) {
  const { kind, upvoteCount } = win;
  if (kind === 'BYE') {
    return (
      <>
        <ByeBadge />
        <span className="text-xs text-muted-foreground">
          {NO_OPPONENT_REASON}
        </span>
      </>
    );
  }
  if (kind === 'EARLY') {
    return (
      <>
        <ByeBadge />
        {upvoteCount !== null && (
          <span className="text-xs text-muted-foreground">
            {SETTLED_VOTES_PREFIX}
            <VoteCount
              count={upvoteCount}
              className="mx-0.5 text-sm font-bold"
            />
          </span>
        )}
      </>
    );
  }
  return upvoteCount === null ? null : (
    <p className="text-sm font-bold text-muted-foreground">
      <VoteCount
        count={upvoteCount}
        className="mr-0.5 text-2xl leading-none font-extrabold"
      />
    </p>
  );
}

// 基準勝利の予選マッチ1件を、対戦相手と比率を出さずに自身の結果だけで示す
export function WinSummary({ win }: WinSummaryProps) {
  return (
    <div
      data-slot="win-summary"
      className="rounded-xl border border-border/70 bg-muted/40 p-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 text-xs">
        <h4 className="inline-flex items-center gap-1 font-bold">
          <TrophyIcon
            aria-hidden="true"
            className="size-3.5 text-gold-strong dark:text-gold"
          />
          {QUALIFIER_WIN_HEADING}
        </h4>
        <span className="text-muted-foreground">
          <LaunchDateText date={win.launchDate} />
        </span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <WinResult win={win} />
      </div>
    </div>
  );
}
