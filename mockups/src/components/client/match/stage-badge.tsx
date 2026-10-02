import { Badge } from '#/components/ui/badge';
import { cn } from '#/lib/utils';

import { ROUND_LABEL } from './model';
import type { MatchKind, Round } from './model';

type Props = {
  kind: MatchKind;
  round: Round | null;
  size?: 'default' | 'lg';
  className?: string;
};

function labelOf(kind: MatchKind, round: Round | null): string {
  if (kind === 'qualifier') return '予選';
  const prefix = kind === 'week' ? 'Week' : 'Year';
  return `${prefix} ${ROUND_LABEL[round ?? 'final']}`;
}

// マッチの種別とラウンド。決勝はゴールド、それ以外のトーナメントはシルバー、予選は枠線のみ
export function StageBadge({ kind, round, size = 'lg', className }: Props) {
  return (
    <Badge
      size={size}
      variant={kind === 'qualifier' ? 'outline' : 'default'}
      className={cn(
        kind !== 'qualifier' && 'border-0 text-gold-foreground',
        kind !== 'qualifier' &&
          (round === 'final' ? 'gold-gradient' : 'bg-silver'),
        className,
      )}
      translate="no"
    >
      {labelOf(kind, round)}
    </Badge>
  );
}
