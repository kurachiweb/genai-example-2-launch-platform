import {
  ChevronDownIcon,
  PackageIcon,
  TrophyIcon,
  UsersIcon,
} from 'lucide-react';
import { useId, useState } from 'react';

import { useDisplayPreferences } from '../../../lib/components/datetime/use-display-preferences.ts';
import { MediaPicture } from '../../../lib/components/media/media-picture.tsx';
import { PathLink } from '../../../lib/components/navigation/path-link.tsx';
import { Badge } from '../../../lib/components/ui/badge/badge.tsx';
import { Button } from '../../../lib/components/ui/button/button.tsx';
import { cn } from '../../../lib/utilities/class-names.ts';
import { formatNumber } from '../../../lib/utilities/number/number-format.ts';
import {
  NO_OPPONENT_REASON,
  SETTLED_VOTES_PREFIX,
} from '../directory/directory-item-messages.ts';
import { productDetailHref } from '../layout/site-links.ts';
import { VOTE_UNIT } from '../match/match-card-messages.ts';
import { HIDDEN_PRODUCT_NAME } from '../match/match-labels.ts';
import { MatchStageBadge } from '../match/match-stage-badge.tsx';
import { voteShareOf } from '../match/vote-bar-model.ts';
import { LaunchDateText } from '../product/launch-date-text.tsx';
import {
  type HistoryOutcome,
  historyOutcomeOf,
  isCloseMatch,
  type ProductPageMatchView,
} from './match-history-model.ts';
import {
  CLOSE_LOSS_NOTE,
  CLOSE_MATCH_LABEL,
  CLOSE_WIN_NOTE,
  NO_OPPONENT_LABEL,
  OPPONENT_PREFIX,
  OUTCOME_LABELS,
  scoreLabel,
  supportersToggleLabel,
  VERSUS_MARK,
  voteRatioLabel,
} from './match-history-messages.ts';
import { SupportersPanel } from './supporters-panel.tsx';

export interface MatchHistoryRowProps {
  readonly match: ProductPageMatchView;
  // 現在のハンドル。サポーターの一覧の照会に使う
  readonly productHandle: string;
}

const WINNING_OUTCOMES: ReadonlySet<HistoryOutcome> = new Set([
  'won',
  'bye',
  'early',
]);

function Opponent({
  opponent,
}: {
  readonly opponent: ProductPageMatchView['opponent'];
}) {
  if (opponent.kind === 'NONE') {
    return (
      <p className="text-sm font-semibold text-muted-foreground">
        {NO_OPPONENT_LABEL}
      </p>
    );
  }
  if (opponent.kind === 'PRIVATE' || opponent.name === null) {
    return (
      <p className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
        <span
          data-slot="hidden-opponent-icon"
          aria-hidden="true"
          className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted"
        >
          <PackageIcon className="size-4" />
        </span>
        <span className="sr-only">{OPPONENT_PREFIX}</span>
        <span>{HIDDEN_PRODUCT_NAME}</span>
      </p>
    );
  }
  const { name, handle } = opponent;
  return (
    <p className="flex min-w-0 items-center gap-2 text-sm font-bold">
      <span data-slot="opponent-logo" className="shrink-0">
        <MediaPicture
          image={opponent.logo}
          display={{ kind: 'square', size: 32 }}
          alt=""
          placeholder={{ label: name, seed: handle ?? name }}
          loading="lazy"
          className="size-8 rounded-lg"
        />
      </span>
      <span
        aria-hidden="true"
        className="text-xs font-normal text-muted-foreground"
      >
        {VERSUS_MARK}
      </span>
      <span className="sr-only">{OPPONENT_PREFIX}</span>
      {opponent.kind === 'LISTED' && handle !== null ? (
        <PathLink
          href={productDetailHref(handle)}
          className="min-w-0 rounded-sm wrap-anywhere text-foreground no-underline hover:underline"
        >
          {name}
        </PathLink>
      ) : (
        <span className="min-w-0 wrap-anywhere">{name}</span>
      )}
    </p>
  );
}

interface CountsProps {
  readonly own: number;
  readonly opponent: number;
}

// 履歴は読み物として静止させるため、対戦カードの演出付きのバーではなく比率だけの帯で示す
function RatioBar({ own, opponent }: CountsProps) {
  const preferences = useDisplayPreferences();
  const { isEmpty, leftRatio } = voteShareOf(own, opponent);
  return (
    <div
      role="img"
      aria-label={voteRatioLabel(
        formatNumber(own, preferences),
        formatNumber(opponent, preferences),
      )}
      className="mt-2 flex h-2 w-full overflow-hidden rounded-full border border-border/60 bg-muted"
    >
      {!isEmpty && (
        <>
          <div
            className="h-full bg-primary"
            style={{ width: `${String(leftRatio * 100)}%` }}
          />
          <div className="h-full flex-1 bg-defeat" />
        </>
      )}
    </div>
  );
}

function Score({ own, opponent }: CountsProps) {
  const preferences = useDisplayPreferences();
  return (
    <p className="text-2xl leading-none font-extrabold tabular-nums">
      {scoreLabel(
        formatNumber(own, preferences),
        formatNumber(opponent, preferences),
      )}
    </p>
  );
}

function SettledVotes({ count }: { readonly count: number }) {
  const preferences = useDisplayPreferences();
  return (
    <p className="text-xs text-muted-foreground">
      {SETTLED_VOTES_PREFIX}
      {formatNumber(count, preferences)}
      {VOTE_UNIT}
    </p>
  );
}

function Outcome({ match }: { readonly match: ProductPageMatchView }) {
  const outcome = historyOutcomeOf(match);
  const won = WINNING_OUTCOMES.has(outcome);
  const close = isCloseMatch(match);
  const { opponentUpvoteCount } = match;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 sm:flex-col sm:items-end sm:gap-1">
      {opponentUpvoteCount !== null && (
        <Score own={match.ownUpvoteCount} opponent={opponentUpvoteCount} />
      )}
      <p className="flex flex-wrap items-center gap-1.5">
        {close && <Badge className="font-bold">{CLOSE_MATCH_LABEL}</Badge>}
        <Badge
          variant={won ? 'default' : 'secondary'}
          className={cn(
            'font-extrabold',
            won && 'border-0 bg-gold text-gold-foreground',
          )}
        >
          {won && <TrophyIcon aria-hidden="true" />}
          {OUTCOME_LABELS[outcome]}
        </Badge>
      </p>
      {close && (
        <p className="text-xs text-muted-foreground">
          {won ? CLOSE_WIN_NOTE : CLOSE_LOSS_NOTE}
        </p>
      )}
      {outcome === 'bye' && (
        <p className="text-xs text-muted-foreground">{NO_OPPONENT_REASON}</p>
      )}
      {outcome === 'early' && <SettledVotes count={match.ownUpvoteCount} />}
    </div>
  );
}

// マッチ履歴の結果が確定したマッチ1件。確定のUpvote数が1以上なら、このプロダクトの側のサポーターの一覧を行の下に開閉する
export function MatchHistoryRow({
  match,
  productHandle,
}: MatchHistoryRowProps) {
  const preferences = useDisplayPreferences();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const close = isCloseMatch(match);
  const { opponentUpvoteCount } = match;
  return (
    <li
      data-close-match={close ? 'true' : undefined}
      className={cn(
        'overflow-hidden rounded-xl border bg-card text-card-foreground shadow-xs',
        close ? 'border-primary ring-2 ring-primary/25' : 'border-border',
      )}
    >
      <div className="grid gap-3 p-3 sm:grid-cols-[7rem_minmax(0,1fr)_auto] sm:items-center sm:gap-4 sm:p-4">
        <div className="flex items-center gap-2 sm:flex-col sm:items-start sm:gap-1">
          <MatchStageBadge match={match} />
          <span className="text-xs text-muted-foreground">
            <LaunchDateText date={match.date} />
          </span>
        </div>
        <div className="min-w-0">
          <Opponent opponent={match.opponent} />
          {opponentUpvoteCount !== null && (
            <RatioBar
              own={match.ownUpvoteCount}
              opponent={opponentUpvoteCount}
            />
          )}
        </div>
        <Outcome match={match} />
      </div>
      {match.ownUpvoteCount > 0 && (
        <>
          <div className="border-t border-border/70 px-3 py-1.5 sm:px-4">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="-ml-2"
              aria-expanded={open}
              aria-controls={panelId}
              onClick={() => {
                setOpen((current) => !current);
              }}
            >
              <UsersIcon aria-hidden="true" />
              {supportersToggleLabel(
                formatNumber(match.ownUpvoteCount, preferences),
              )}
              <ChevronDownIcon
                aria-hidden="true"
                className={cn('transition-transform', open && 'rotate-180')}
              />
            </Button>
          </div>
          <SupportersPanel
            id={panelId}
            open={open}
            productHandle={productHandle}
            matchId={match.id}
            entryId={match.entryId}
          />
        </>
      )}
    </li>
  );
}
