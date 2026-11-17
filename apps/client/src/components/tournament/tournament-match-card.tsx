import type { MatchFragment } from '../../graphql/generated/graphql.ts';
import { MatchCard } from '../match/match-card.tsx';
import { useUpvote } from '../match/use-upvote.ts';

export interface TournamentMatchCardProps {
  readonly match: MatchFragment;
  // Upvote・取り消しの成功でサーバーが返したマッチを、呼び出し元の取得の結果(キャッシュ)へ反映する
  readonly onUpdated: (match: MatchFragment) => void;
  readonly className?: string;
}

// トーナメントの対戦カード。Upvoteの操作と未ログインの閲覧者へのログインの案内を持つ
export function TournamentMatchCard({
  match,
  onUpdated,
  className,
}: TournamentMatchCardProps) {
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
        className={className}
      />
      {loginDialog}
    </>
  );
}
