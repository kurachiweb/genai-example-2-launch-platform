import {
  INQUIRY_STATUS_LABELS,
  type InquiryStatus,
} from '../../../common-lib/inquiry/inquiry-status.ts';
import { Badge } from '../ui/badge/badge.tsx';
import type { BadgeVariant } from '../ui/badge/badge-variants.ts';

export interface InquiryStatusBadgeProps {
  readonly status: InquiryStatus;
}

interface StatusAppearance {
  readonly variant: BadgeVariant;
  readonly className?: string;
}

// 対応が要る状態ほど目立たせる。色だけに頼らず表示名の文言で状態を示す
const STATUS_APPEARANCES: Readonly<Record<InquiryStatus, StatusAppearance>> =
  Object.freeze({
    open: { variant: 'default' },
    in_progress: { variant: 'secondary' },
    resolved: { variant: 'outline' },
    rejected: {
      variant: 'ghost',
      className: 'border-dashed border-border text-muted-foreground',
    },
  });

export function InquiryStatusBadge({ status }: InquiryStatusBadgeProps) {
  const { variant, className } = STATUS_APPEARANCES[status];
  return (
    <Badge variant={variant} className={className}>
      {INQUIRY_STATUS_LABELS[status]}
    </Badge>
  );
}
