import { Badge } from '../../../lib/components/ui/badge/badge.tsx';
import { cn } from '../../../lib/utilities/class-names.ts';
import { type MatchStageLabelInput, matchStageLabel } from './match-labels.ts';

export interface MatchStageBadgeProps {
  readonly match: MatchStageLabelInput;
  readonly className?: string;
}

// 種別の印は、決勝をゴールド、それ以外のトーナメントをシルバー、予選を枠線だけで示す
export function MatchStageBadge({ match, className }: MatchStageBadgeProps) {
  const isTournament = match.kind !== 'QUALIFIER';
  return (
    <Badge
      variant={isTournament ? 'default' : 'outline'}
      translate="no"
      className={cn(
        isTournament && 'border-0 text-gold-foreground',
        isTournament && (match.stage === 'FINAL' ? 'bg-gold' : 'bg-silver'),
        className,
      )}
    >
      {matchStageLabel(match)}
    </Badge>
  );
}
