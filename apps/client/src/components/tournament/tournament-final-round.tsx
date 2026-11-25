import { TrophyIcon } from 'lucide-react';
import { type CSSProperties, useId } from 'react';

import { cn } from '../../../lib/utilities/class-names.ts';
import type { MatchFragment } from '../../graphql/generated/graphql.ts';
import { teamColorsOf } from '../match/team-colors.ts';
import type { BoardRoundSplit } from './tournament-board-model.ts';
import { TournamentBracketLink } from './tournament-bracket-link.tsx';
import type { TournamentFinalCopy } from './tournament-copy.ts';
import type { TournamentFinalOutcome } from './tournament-final-model.ts';
import { TournamentMatchCard } from './tournament-match-card.tsx';

export interface TournamentFinalRoundProps {
  readonly row: BoardRoundSplit;
  // 期間の表記(週の「2026年第37週(9/7〜9/13)」や対象年など)
  readonly periodLabel: string;
  readonly bracketPath: string;
  readonly copy: TournamentFinalCopy;
  // 確定の後の結果。確定の前はnull
  readonly outcome: TournamentFinalOutcome | null;
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

// 照明と、受賞の後の紙吹雪。動きはtournament-final-showcase.cssが自動更新の状態と視差効果を減らす設定で決める
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
      data-tournament-final-effects=""
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 overflow-hidden"
    >
      <div data-tournament-final-spotlight="left" className="left-[6%]" />
      <div data-tournament-final-spotlight="right" className="right-[6%]" />
      {awarded &&
        Array.from({ length: CONFETTI_COUNT }, (_, i) => (
          <span
            key={i}
            data-tournament-final-confetti=""
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

// 決勝の1行を、ページの全幅の注目の区画(種類の印・見出し・期間の表記とブラケットのページへのリンク・結果の状態の文・全幅の対戦カード)で描く。
// 不戦勝・早期勝利の決勝は、不戦勝の一覧の文言が次のラウンドへ進む旨のため一覧に並べず、受賞の文だけで示す
export function TournamentFinalRound({
  row,
  periodLabel,
  bracketPath,
  copy,
  outcome,
  statusMessage,
  onUpdated,
}: TournamentFinalRoundProps) {
  const headingId = useId();
  const { cards } = row;
  const outcomeText =
    outcome?.kind === 'awarded'
      ? copy.awarded(outcome.productName)
      : copy.noAward;
  const statusText = outcome === null ? statusMessage : outcomeText;
  return (
    <section
      aria-labelledby={headingId}
      className="relative isolate mt-4 overflow-hidden border-y border-gold/50 bg-card text-card-foreground"
    >
      <FinalEffects cards={cards} awarded={outcome?.kind === 'awarded'} />
      <div className="relative mx-auto w-full max-w-7xl px-4 pt-8 pb-4 text-center">
        <p className="inline-flex items-center gap-2 rounded-full border border-gold/60 bg-gold/10 px-4 py-1 text-xs font-bold tracking-[0.15em] text-gold-foreground uppercase dark:text-gold">
          <TrophyIcon className="size-4" aria-hidden="true" />
          {copy.badge}
        </p>
        <h2
          id={headingId}
          className="mt-3 font-display text-4xl font-extrabold tracking-tight text-balance sm:text-6xl"
        >
          <span className="text-gold-foreground dark:text-gold">
            {copy.title}
          </span>
          <span className="block text-2xl text-foreground sm:text-4xl">
            {copy.subtitle}
          </span>
        </h2>
        <p className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span>{periodLabel}</span>
          <TournamentBracketLink href={bracketPath} />
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
        <TournamentMatchCard
          key={match.id}
          match={match}
          onUpdated={onUpdated}
          className="relative w-full rounded-none border-x-0 border-b-0 shadow-none"
        />
      ))}
    </section>
  );
}
