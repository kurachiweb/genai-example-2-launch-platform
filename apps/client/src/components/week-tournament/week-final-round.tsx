import { TrophyIcon } from 'lucide-react';
import { type CSSProperties, useId } from 'react';

import { cn } from '../../../lib/utilities/class-names.ts';
import type { MatchFragment } from '../../graphql/generated/graphql.ts';
import { teamColorsOf } from '../match/team-colors.ts';
import { WeekBracketLink } from './week-bracket-link.tsx';
import type { WeekSectionRound } from './week-board-model.ts';
import type { WeekFinalOutcome } from './week-final-model.ts';
import { WeekMatchCard } from './week-match-card.tsx';
import {
  WEEK_FINAL_BADGE,
  WEEK_FINAL_NO_AWARD_MESSAGE,
  WEEK_FINAL_SUBTITLE,
  WEEK_FINAL_TITLE,
  weekFinalAwardedMessage,
} from './week-tournament-messages.ts';

export interface WeekFinalRoundProps {
  readonly row: WeekSectionRound;
  // 確定の後の結果。確定の前はnull
  readonly outcome: WeekFinalOutcome | null;
  // 確定の前に状態の領域へ出す文。結果の反映を待つ取り直しが上限に達した時に呼び出し元が渡す
  readonly statusMessage: string | null;
  // Upvote・取り消しの成功でサーバーが返したマッチを、呼び出し元の取得の結果(キャッシュ)へ反映する
  readonly onUpdated: (match: MatchFragment) => void;
}

const CONFETTI_COUNT = 36;

const confettiColorsOf = (cards: readonly MatchFragment[]): string[] => [
  'var(--gold)',
  'var(--gold-strong)',
  ...cards.flatMap(({ entries }) =>
    entries.flatMap(({ colorIndex }) => teamColorsOf(colorIndex)),
  ),
];

// 照明と、受賞の後の紙吹雪。動きはweek-final-showcase.cssが自動更新の状態と視差効果を減らす設定で決める
function FinalEffects({
  cards,
  awarded,
}: {
  readonly cards: readonly MatchFragment[];
  readonly awarded: boolean;
}) {
  const colors = confettiColorsOf(cards);
  return (
    <div
      data-week-final-effects=""
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 overflow-hidden"
    >
      <div data-week-final-spotlight="left" className="left-[6%]" />
      <div data-week-final-spotlight="right" className="right-[6%]" />
      {awarded &&
        Array.from({ length: CONFETTI_COUNT }, (_, i) => (
          <span
            key={i}
            data-week-final-confetti=""
            style={
              {
                left: `${String((i * 37) % 100)}%`,
                backgroundColor: colors[i % colors.length],
                '--fall-duration': `${String(7 + ((i * 13) % 6))}s`,
                '--fall-delay': `${String(-((i * 7) % 12))}s`,
                '--sway': `${String((i % 2 === 0 ? 1 : -1) * (24 + ((i * 11) % 40)))}px`,
              } as CSSProperties
            }
          />
        ))}
    </div>
  );
}

const outcomeTextOf = (outcome: WeekFinalOutcome): string =>
  outcome.kind === 'awarded'
    ? weekFinalAwardedMessage(outcome.productName)
    : WEEK_FINAL_NO_AWARD_MESSAGE;

// 決勝の1行を、ページの全幅の注目の区画(「Week Final」の印・見出し・週の表記とブラケットのページへのリンク・結果の状態の文・全幅の対戦カード)で描く。
// 不戦勝・早期勝利の決勝は、不戦勝の一覧の文言が次のラウンドへ進む旨のため一覧に並べず、受賞の文だけで示す
export function WeekFinalRound({
  row,
  outcome,
  statusMessage,
  onUpdated,
}: WeekFinalRoundProps) {
  const headingId = useId();
  const { round, cards } = row;
  const statusText = outcome === null ? statusMessage : outcomeTextOf(outcome);
  return (
    <section
      aria-labelledby={headingId}
      className="relative isolate mt-4 overflow-hidden border-y border-gold/50 bg-card text-card-foreground"
    >
      <FinalEffects cards={cards} awarded={outcome?.kind === 'awarded'} />
      <div className="relative mx-auto w-full max-w-7xl px-4 pt-8 pb-4 text-center">
        <p className="inline-flex items-center gap-2 rounded-full border border-gold/60 bg-gold/10 px-4 py-1 text-xs font-bold tracking-[0.15em] text-gold-foreground uppercase dark:text-gold">
          <TrophyIcon className="size-4" aria-hidden="true" />
          {WEEK_FINAL_BADGE}
        </p>
        <h2
          id={headingId}
          className="mt-3 font-display text-4xl font-extrabold tracking-tight text-balance sm:text-6xl"
        >
          <span className="text-gold-foreground dark:text-gold">
            {WEEK_FINAL_TITLE}
          </span>
          <span className="block text-2xl text-foreground sm:text-4xl">
            {WEEK_FINAL_SUBTITLE}
          </span>
        </h2>
        <p className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span>{round.tournament.label}</span>
          <WeekBracketLink href={round.bracketPath} />
        </p>
        {/* 結果が加わった時に読み上げられるよう、文が無い間も領域を置いておく */}
        <div role="status" className="mt-4 empty:mt-0">
          {statusText !== null && (
            <p
              className={cn(
                'inline-block rounded-2xl px-6 py-3 text-lg font-extrabold sm:text-2xl',
                outcome?.kind === 'awarded'
                  ? 'bg-gold text-gold-foreground shadow-lg'
                  : 'bg-muted text-foreground',
              )}
            >
              {statusText}
            </p>
          )}
        </div>
      </div>
      {cards.map((match) => (
        <WeekMatchCard
          key={match.id}
          match={match}
          onUpdated={onUpdated}
          className="relative w-full rounded-none border-x-0 border-b-0 shadow-none"
        />
      ))}
    </section>
  );
}
