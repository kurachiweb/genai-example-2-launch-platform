import { TrophyIcon } from 'lucide-react';

import { paletteColors } from '#/components/client/art';
import type { User } from '#/lib/mock-data';
import { cn } from '#/lib/utils';

import { matchWinner } from '../-model';
import type { Match } from '../-model';
import { MatchStage } from './match-stage';

type Props = {
  kind: 'week' | 'year';
  match: Match;
  isLive: boolean;
  user: User | null;
  onRequireLogin: () => void;
};

const CONFETTI_COUNT = 36;

export function FinalShowcase({
  kind,
  match,
  isLive,
  user,
  onRequireLogin,
}: Props) {
  const season = '2025-2026';
  const title = kind === 'week' ? 'Product of the Week' : 'Product of the Year';
  const subtitle = kind === 'week' ? '2026年第37週(9/7〜9/13)' : '';
  const winner = isLive ? null : matchWinner(match);
  const winnerProduct =
    winner === 'left' ? match.left : winner === 'right' ? match.right : null;
  const colors = [
    'var(--gold)',
    'var(--gold-strong)',
    ...paletteColors(match.left.art.palette),
    ...paletteColors(match.right.art.palette),
  ];

  return (
    <section
      aria-labelledby={`final-${kind}`}
      className="relative isolate mt-4 overflow-hidden border-y border-gold/50 bg-card"
    >
      <div
        className="confetti-layer pointer-events-none absolute inset-0 overflow-hidden"
        aria-hidden="true"
      >
        <div className="spotlight left-[6%]" data-side="left" />
        <div className="spotlight right-[6%]" data-side="right" />
        {!isLive &&
          Array.from({ length: CONFETTI_COUNT }, (_, i) => (
            <span
              key={i}
              className="confetti-piece"
              style={
                {
                  left: `${(i * 37) % 100}%`,
                  backgroundColor: colors[i % colors.length],
                  '--fall-duration': `${7 + ((i * 13) % 6)}s`,
                  '--fall-delay': `${-((i * 7) % 12)}s`,
                  '--sway': `${(i % 2 === 0 ? 1 : -1) * (24 + ((i * 11) % 40))}px`,
                } as React.CSSProperties
              }
            />
          ))}
      </div>

      <div className="relative mx-auto w-full max-w-350 px-4 pt-8 pb-4 text-center">
        <p className="inline-flex items-center gap-2 rounded-full border border-gold/60 bg-gold/10 px-4 py-1 text-xs font-bold tracking-[0.15em] text-gold-foreground uppercase dark:text-gold">
          <TrophyIcon className="size-4" aria-hidden="true" />
          {kind === 'week' ? 'Week Final' : `${season} Year Final`}
        </p>
        <h2
          id={`final-${kind}`}
          className="scoreboard-digits mt-3 text-4xl tracking-tight text-balance sm:text-6xl"
        >
          <span className="gold-gradient bg-clip-text text-transparent">
            {title}
          </span>
          <span className="block text-2xl font-extrabold text-foreground sm:text-4xl">
            トーナメント決勝
          </span>
        </h2>
        {subtitle && (
          <p className="mt-3 text-sm text-muted-foreground">{subtitle}</p>
        )}
        {!isLive && (
          <p
            className={cn(
              'mt-4 inline-block rounded-2xl px-6 py-3 text-lg font-extrabold sm:text-2xl',
              winnerProduct
                ? 'gold-gradient text-gold-foreground shadow-lg'
                : 'bg-muted',
            )}
            role="status"
          >
            {winnerProduct
              ? `フルタイム! ${winnerProduct.name}が${title}を受賞🎉`
              : 'フルタイム。0対0で両者敗北。今回の受賞プロダクトはありません'}
          </p>
        )}
      </div>

      <div className="relative w-full">
        <div className="overflow-hidden border-y border-gold/40">
          <MatchStage
            match={match}
            isLive={isLive}
            user={user}
            variant="final"
            onRequireLogin={onRequireLogin}
          />
        </div>
      </div>
    </section>
  );
}
