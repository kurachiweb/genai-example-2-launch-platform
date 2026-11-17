import { useId } from 'react';

import { cn } from '../../../lib/utilities/class-names.ts';
import type { MatchFragment } from '../../graphql/generated/graphql.ts';
import { ByeList } from '../match/bye-list.tsx';
import { MatchCard } from '../match/match-card.tsx';
import { useUpvote } from '../match/use-upvote.ts';
import type { WeekSectionRound } from './week-board-model.ts';
import { WeekSectionHeading } from './week-section-heading.tsx';

export interface WeekBoardRoundProps {
  readonly row: WeekSectionRound;
  // Upvote・取り消しの成功でサーバーが返したマッチを、呼び出し元の取得の結果(キャッシュ)へ反映する
  readonly onUpdated: (match: MatchFragment) => void;
  // 見出しの下の状態の領域に出す文。結果の反映を待つ取り直しが上限に達した時に呼び出し元が渡す。undefinedなら状態の領域を置かない
  readonly statusMessage?: string | null;
}

function WeekMatchCard({
  match,
  onUpdated,
}: {
  readonly match: MatchFragment;
  readonly onUpdated: (match: MatchFragment) => void;
}) {
  const { pendingEntryId, toggle, loginDialog } = useUpvote({
    match,
    onUpdated,
  });
  return (
    <>
      <MatchCard
        match={match}
        pendingEntryId={pendingEntryId}
        onToggleUpvote={toggle}
      />
      {loginDialog}
    </>
  );
}

// トーナメントとラウンドの1行を、見出し・対戦カード(画面幅1280px以上は2列)・末尾の不戦勝の一覧で描く
export function WeekBoardRound({
  row,
  onUpdated,
  statusMessage,
}: WeekBoardRoundProps) {
  const headingId = useId();
  const { round, cards, byes } = row;
  return (
    <section aria-labelledby={headingId}>
      <WeekSectionHeading
        id={headingId}
        roundName={round.roundName}
        weekLabel={round.tournament.label}
        finalDate={round.tournament.finalDate}
        bracketPath={round.bracketPath}
      />
      {statusMessage !== undefined && (
        // 文が加わった時に読み上げられるよう、文が無い間も領域を置いておく
        <p role="status" className="mt-2 text-sm font-medium empty:mt-0">
          {statusMessage}
        </p>
      )}
      {cards.length > 0 && (
        <div
          className={cn(
            'mt-4 grid gap-4',
            cards.length > 1 && 'xl:grid-cols-2',
          )}
        >
          {cards.map((match) => (
            <WeekMatchCard key={match.id} match={match} onUpdated={onUpdated} />
          ))}
        </div>
      )}
      <ByeList byes={byes} />
    </section>
  );
}
