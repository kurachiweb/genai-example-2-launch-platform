import { type ReactNode, useId } from 'react';

import { cn } from '../../../lib/utilities/class-names.ts';
import type { MatchFragment } from '../../graphql/generated/graphql.ts';
import { ByeList } from '../match/bye-list.tsx';
import type { BoardRoundSplit } from './tournament-board-model.ts';
import { TournamentMatchCard } from './tournament-match-card.tsx';

export interface TournamentBoardRoundProps {
  readonly row: BoardRoundSplit;
  // Upvote・取り消しの成功でサーバーが返したマッチを、呼び出し元の取得の結果(キャッシュ)へ反映する
  readonly onUpdated: (match: MatchFragment) => void;
  // 見出しの下の状態の領域に出す文。結果の反映を待つ取り直しが上限に達した時に呼び出し元が渡す。undefinedなら状態の領域を置かない
  readonly statusMessage?: string | null;
  // 種類の値を持つ見出し。引数は区画の`aria-labelledby`が指す見出しのid
  readonly children: (headingId: string) => ReactNode;
}

// トーナメントとラウンドの1行を、見出し・対戦カード(画面幅1280px以上は2列)・末尾の不戦勝の一覧で描く
export function TournamentBoardRound({
  row,
  onUpdated,
  statusMessage,
  children,
}: TournamentBoardRoundProps) {
  const headingId = useId();
  const { cards, byes } = row;
  return (
    <section aria-labelledby={headingId}>
      {children(headingId)}
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
            <TournamentMatchCard
              key={match.id}
              match={match}
              onUpdated={onUpdated}
            />
          ))}
        </div>
      )}
      <ByeList byes={byes} />
    </section>
  );
}
