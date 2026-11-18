import {
  SPONSORSHIP_STATUS_LABELS,
  type SponsorshipStatus,
} from '../../../common-lib/sponsorship/sponsorship-status.ts';
import { Badge } from '../ui/badge/badge.tsx';
import type { BadgeVariant } from '../ui/badge/badge-variants.ts';

export interface SponsorshipStatusBadgeProps {
  readonly status: SponsorshipStatus;
}

interface StatusAppearance {
  readonly variant: BadgeVariant;
  readonly className?: string;
}

// 掲載中を最も目立たせ、対応や注意が要る未決済・表示停止中・強制終了を枠で区別する。色だけに頼らず表示名の文言で状態を示す
const STATUS_APPEARANCES: Readonly<
  Record<SponsorshipStatus, StatusAppearance>
> = Object.freeze({
  pending_payment: { variant: 'outline' },
  scheduled: { variant: 'secondary' },
  active: { variant: 'default' },
  paused: { variant: 'outline', className: 'border-dashed' },
  ended: {
    variant: 'ghost',
    className: 'border-dashed border-border text-muted-foreground',
  },
  terminated: {
    variant: 'outline',
    className: 'border-destructive text-destructive',
  },
});

export function SponsorshipStatusBadge({
  status,
}: SponsorshipStatusBadgeProps) {
  const { variant, className } = STATUS_APPEARANCES[status];
  return (
    <Badge variant={variant} className={className}>
      {SPONSORSHIP_STATUS_LABELS[status]}
    </Badge>
  );
}
