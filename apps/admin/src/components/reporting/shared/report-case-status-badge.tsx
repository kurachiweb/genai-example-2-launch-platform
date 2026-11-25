import type { ReportCaseStatus } from '../../../../common-lib/reporting/report-case-rules.ts';
import { REPORT_CASE_STATUS_LABELS } from '../../../../common-lib/reporting/report-labels.ts';
import { Badge } from '../../../../lib/components/ui/badge/badge.tsx';
import type { BadgeVariant } from '../../../../lib/components/ui/badge/badge-variants.ts';

export interface ReportCaseStatusBadgeProps {
  readonly status: ReportCaseStatus;
}

interface StatusAppearance {
  readonly variant: BadgeVariant;
  readonly className?: string;
}

// 対応が要る状態ほど目立たせ、問い合わせの対応ステータスと同じ見た目にそろえる。色だけに頼らず表示名の文言で状態を示す
const STATUS_APPEARANCES: Readonly<Record<ReportCaseStatus, StatusAppearance>> =
  Object.freeze({
    open: { variant: 'default' },
    in_progress: { variant: 'secondary' },
    resolved: { variant: 'outline' },
    rejected: {
      variant: 'ghost',
      className: 'border-dashed border-border text-muted-foreground',
    },
  });

export function ReportCaseStatusBadge({ status }: ReportCaseStatusBadgeProps) {
  const { variant, className } = STATUS_APPEARANCES[status];
  return (
    <Badge variant={variant} className={className}>
      {REPORT_CASE_STATUS_LABELS[status]}
    </Badge>
  );
}
