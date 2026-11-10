import type { ReactNode } from 'react';

import { Badge } from '../../../lib/components/ui/badge/badge.tsx';
import { cn } from '../../../lib/utilities/class-names.ts';
import type { MatchFragment } from '../../graphql/generated/graphql.ts';
import { matchCardLabel } from './match-card-messages.ts';
import { entryNameOf, matchHeadlineOf } from './match-card-model.ts';
import { matchStageLabel } from './match-labels.ts';
import { MatchStage } from './match-stage.tsx';

export interface MatchCardProps {
  readonly match: MatchFragment;
  // マッチ中に見出しの行へ示す補足。トーナメントの区画などの呼び出し元が渡す
  readonly caption?: ReactNode;
  // 送信中の側。送信中でなければnull
  readonly pendingEntryId?: string | null;
  readonly onToggleUpvote: (entryId: string) => void;
  readonly className?: string;
}

// 種別の印は、決勝をゴールド、それ以外のトーナメントをシルバー、予選を枠線だけで示す
function StageBadge({ match }: { readonly match: MatchFragment }) {
  const isTournament = match.kind !== 'QUALIFIER';
  return (
    <Badge
      variant={isTournament ? 'default' : 'outline'}
      translate="no"
      className={cn(
        isTournament && 'border-0 text-gold-foreground',
        isTournament && (match.stage === 'FINAL' ? 'bg-gold' : 'bg-silver'),
      )}
    >
      {matchStageLabel(match)}
    </Badge>
  );
}

function Headline({
  match,
  caption,
}: {
  readonly match: MatchFragment;
  readonly caption: ReactNode;
}) {
  const headline = matchHeadlineOf(match);
  switch (headline.kind) {
    case 'caption':
      return (
        <span className="flex items-center gap-1.5 text-muted-foreground">
          {caption}
        </span>
      );
    case 'text':
      return (
        <span className="font-semibold text-foreground">{headline.text}</span>
      );
    case 'none':
      return <span />;
  }
}

export function MatchCard({
  match,
  caption = null,
  pendingEntryId = null,
  onToggleUpvote,
  className,
}: MatchCardProps) {
  const [left, right] = match.entries;
  if (left === undefined || right === undefined) {
    return null;
  }
  return (
    <article
      aria-label={matchCardLabel(entryNameOf(left), entryNameOf(right))}
      className={cn(
        'flex flex-col overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-md',
        className,
      )}
    >
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-4 py-2 text-xs">
        <Headline match={match} caption={caption} />
        <StageBadge match={match} />
      </header>
      <MatchStage
        match={match}
        pendingEntryId={pendingEntryId}
        onToggleUpvote={onToggleUpvote}
      />
    </article>
  );
}
