import { Badge } from '#/components/ui/badge';
import type { User } from '#/lib/mock-data';
import { cn } from '#/lib/utils';

import { matchWinner, ROUND_LABEL } from './model';
import type { Match, Round } from './model';
import { MatchStage } from './match-stage';

type Props = {
  match: Match;
  isLive: boolean;
  user: User | null;
  accent?: 'gold';
  round?: Round;
  // 開催中のヘッダー左側に表示する補足(勝敗結果表示中は結果文言が優先される)
  caption?: React.ReactNode;
  // ログイン済みでもUpvoteできない理由(メールアドレス未確認など)
  restriction?: string | null;
  onRequireLogin: () => void;
};

export function MatchCard({
  match,
  isLive,
  user,
  accent,
  round,
  caption,
  restriction,
  onRequireLogin,
}: Props) {
  const winner = matchWinner(match);

  return (
    <article
      aria-label={`${match.left.name} vs ${match.right.name}`}
      // 画面幅640px未満では親main要素の余白(px-4)を負のマージンで打ち消し、画面端まで全幅で表示する
      className={cn(
        'rise-in -mx-4 flex flex-col overflow-hidden border-y bg-card shadow-md sm:mx-0 sm:rounded-2xl sm:border',
        accent === 'gold' ? 'border-gold/60 shadow-gold/10' : 'border-border',
      )}
    >
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-4 py-2 text-xs">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          {isLive ? caption : <ResultLabel match={match} winner={winner} />}
        </span>
        {round ? (
          <Badge
            size="lg"
            className={`border-0 text-gold-foreground ${round === 'final' ? 'gold-gradient' : 'bg-silver'}`}
          >
            {ROUND_LABEL[round]}
          </Badge>
        ) : (
          <Badge size="lg" variant="outline">
            予選
          </Badge>
        )}
      </header>
      <MatchStage
        match={match}
        isLive={isLive}
        user={user}
        variant="card"
        restriction={restriction}
        onRequireLogin={onRequireLogin}
      />
    </article>
  );
}

function ResultLabel({
  match,
  winner,
}: {
  match: Match;
  winner: ReturnType<typeof matchWinner>;
}) {
  if (winner === 'none') {
    return (
      <span className="font-semibold text-foreground">
        フルタイム。0対0で両者敗北
      </span>
    );
  }
  const winnerName = winner === 'left' ? match.left.name : match.right.name;
  const own = winner === 'left' ? match.leftVotes : match.rightVotes;
  const other = winner === 'left' ? match.rightVotes : match.leftVotes;
  const tieNote = own === other ? '(最終Upvote時刻が早いため)' : '';
  return (
    <span className="font-semibold text-foreground">
      フルタイム！{own}対{other}で{winnerName}の勝利{tieNote}
    </span>
  );
}
