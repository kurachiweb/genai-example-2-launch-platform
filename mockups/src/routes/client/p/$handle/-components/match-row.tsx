import { useId, useState } from 'react';
import { Link } from '@tanstack/react-router';
import {
  ChevronDownIcon,
  ShieldQuestionIcon,
  TrophyIcon,
  UsersIcon,
} from 'lucide-react';

import { paletteColors } from '#/components/client/art/palettes';
import { ROUND_LABEL } from '#/components/client/match/model';
import { ProductLogo } from '#/components/client/product-logo';
import { Badge } from '#/components/ui/badge';
import { Button } from '#/components/ui/button';
import { useDateTimeFormatter } from '#/lib/date-format';
import type { Product } from '#/lib/mock-data';
import { cn } from '#/lib/utils';

import { isoDate } from '../-model/clock';
import type { HistoryMatch } from '../-model/launches';
import { usePageContext } from './page-context';
import { SupportersPanel } from './supporters-panel';

type Props = {
  match: HistoryMatch;
  product: Product;
};

function stageOf(match: HistoryMatch): string {
  if (match.kind === 'qualifier') return '予選';
  const prefix = match.kind === 'week' ? 'Week' : 'Year';
  return `${prefix} ${ROUND_LABEL[match.round ?? 'final']}`;
}

export function MatchRow({ match, product }: Props) {
  const { imagesBroken } = usePageContext();
  const dateFormatter = useDateTimeFormatter('dateWeekday');
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const isTie = match.tieBreak !== null;

  return (
    <li
      className={cn(
        'overflow-hidden rounded-xl border bg-card shadow-xs',
        isTie ? 'border-primary ring-2 ring-primary/25' : 'border-border',
      )}
    >
      <div className="grid gap-3 p-3 sm:grid-cols-[7rem_minmax(0,1fr)_auto] sm:items-center sm:gap-4 sm:p-4">
        <div className="flex items-center gap-2 sm:flex-col sm:items-start sm:gap-1">
          <Badge
            size="lg"
            variant={match.kind === 'qualifier' ? 'outline' : 'default'}
            className={cn(
              match.kind !== 'qualifier' && 'border-0 text-gold-foreground',
              match.kind !== 'qualifier' &&
                (match.round === 'final' ? 'gold-gradient' : 'bg-silver'),
            )}
            translate="no"
          >
            {stageOf(match)}
          </Badge>
          <time
            dateTime={isoDate(match.date)}
            className="text-xs text-muted-foreground"
          >
            {dateFormatter.format(match.date)}
          </time>
        </div>

        <div className="min-w-0">
          <Opponent match={match} broken={imagesBroken} />
          <ScoreBar match={match} product={product} />
        </div>

        <Outcome match={match} />
      </div>

      {match.supporterCount > 0 && (
        <>
          <div className="border-t border-border/70 px-3 py-1.5 sm:px-4">
            <Button
              size="sm"
              variant="ghost"
              className="-ml-2"
              aria-expanded={open}
              aria-controls={panelId}
              onClick={() => setOpen((current) => !current)}
            >
              <UsersIcon aria-hidden="true" />
              サポーター{match.supporterCount.toLocaleString()}人
              <ChevronDownIcon
                aria-hidden="true"
                className={cn('transition-transform', open && 'rotate-180')}
              />
            </Button>
          </div>
          {open && (
            <SupportersPanel
              id={panelId}
              matchId={match.id}
              total={match.supporterCount}
            />
          )}
        </>
      )}
    </li>
  );
}

function Opponent({ match, broken }: { match: HistoryMatch; broken: boolean }) {
  const { opponent } = match;
  if (!opponent) {
    return (
      <p className="text-sm font-semibold text-muted-foreground">
        対戦相手なし
      </p>
    );
  }
  if (opponent.status === 'private') {
    return (
      <p className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted">
          <ShieldQuestionIcon className="size-4" aria-hidden="true" />
        </span>
        <span>
          <span className="sr-only">対戦相手: </span>非公開のプロダクト
        </span>
      </p>
    );
  }
  const { product } = opponent;
  return (
    <p className="flex min-w-0 items-center gap-2 text-sm font-bold">
      <ProductLogo product={product} size={32} broken={broken} />
      <span className="text-xs font-normal text-muted-foreground">vs</span>
      {opponent.status === 'public' ? (
        <Link
          to="/client/p/$handle"
          params={{ handle: product.handle }}
          className="min-w-0 wrap-anywhere text-foreground no-underline hover:underline"
        >
          {product.name}
        </Link>
      ) : (
        <span className="min-w-0 wrap-anywhere">{product.name}</span>
      )}
    </p>
  );
}

function ScoreBar({
  match,
  product,
}: {
  match: HistoryMatch;
  product: Product;
}) {
  if (match.ownVotes === null || match.opponentVotes === null) return null;
  const total = match.ownVotes + match.opponentVotes;
  const [ownColor] = paletteColors(product.art.palette);
  // 両者の主色が同じだと比率が読み取れないため、相手側は副色に切り替える
  const opponentColor = (() => {
    if (
      match.opponent?.status !== 'public' &&
      match.opponent?.status !== 'unlisted'
    ) {
      return 'var(--defeat)';
    }
    const [primary, secondary] = paletteColors(
      match.opponent.product.art.palette,
    );
    return primary === ownColor ? secondary : primary;
  })();
  return (
    <div
      role="img"
      aria-label={`Upvote数の比率: ${match.ownVotes}対${match.opponentVotes}`}
      className="mt-2 flex h-2 w-full overflow-hidden rounded-full border border-border/60 bg-muted"
    >
      {total > 0 && (
        <>
          <div
            className="h-full"
            style={{
              width: `${(match.ownVotes / total) * 100}%`,
              backgroundColor: ownColor,
            }}
          />
          <div
            className="h-full flex-1"
            style={{ backgroundColor: opponentColor }}
          />
        </>
      )}
    </div>
  );
}

function Outcome({ match }: { match: HistoryMatch }) {
  const chip = (() => {
    switch (match.result) {
      case 'win':
        return {
          label: '勝利',
          className: 'gold-gradient text-gold-foreground',
        };
      case 'bye':
      case 'early':
        return {
          label: '不戦勝',
          className: 'gold-gradient text-gold-foreground',
        };
      case 'both-lose':
        return { label: '両者敗北', className: 'bg-muted text-defeat' };
      default:
        return { label: '敗北', className: 'bg-muted text-defeat' };
    }
  })();
  const won = chip.className.includes('gold');

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 sm:flex-col sm:items-end sm:gap-1">
      {match.ownVotes !== null && match.result !== 'early' && (
        <p className="scoreboard-digits text-2xl leading-none">
          {match.ownVotes}
          <span className="mx-1 text-sm font-bold text-muted-foreground">
            対
          </span>
          {match.opponentVotes}
        </p>
      )}
      <p className="flex flex-wrap items-center gap-1.5">
        {match.tieBreak && (
          <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-bold text-primary-foreground">
            接戦
          </span>
        )}
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-extrabold',
            chip.className,
          )}
        >
          {won && <TrophyIcon className="size-3" aria-hidden="true" />}
          {chip.label}
        </span>
      </p>
      {match.tieBreak && (
        <p className="text-xs text-muted-foreground">
          {match.tieBreak === 'won'
            ? '同点・最終Upvote時間が早く勝利'
            : '同点・最終Upvote時間の差で敗北'}
        </p>
      )}
      {match.result === 'early' && (
        <p className="text-xs text-muted-foreground">
          確定時点で
          <span className="scoreboard-digits mx-0.5 text-sm text-foreground">
            {match.ownVotes}
          </span>
          票
        </p>
      )}
      {match.result === 'bye' && (
        <p className="text-xs text-muted-foreground">対戦相手がいないため</p>
      )}
    </div>
  );
}
