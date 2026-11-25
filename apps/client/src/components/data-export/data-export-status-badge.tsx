import {
  DATA_EXPORT_DISPLAY_STATUS_LABELS,
  type DataExportDisplayStatus,
} from '../../../common-lib/data-export/data-export-rules.ts';
import { Badge } from '../../../lib/components/ui/badge/badge.tsx';
import type { BadgeVariant } from '../../../lib/components/ui/badge/badge-variants.ts';
import type { DataExportStatus } from '../../graphql/generated/graphql.ts';

export interface DataExportStatusBadgeProps {
  readonly status: DataExportStatus;
}

const DISPLAY_STATUS_OF: Readonly<
  Record<DataExportStatus, DataExportDisplayStatus>
> = Object.freeze({
  PENDING: 'pending',
  READY: 'ready',
  EXPIRED: 'expired',
  FAILED: 'failed',
});

// 色だけに頼らず表示名の文言で状態を示す
const VARIANT_OF: Readonly<Record<DataExportDisplayStatus, BadgeVariant>> =
  Object.freeze({
    pending: 'secondary',
    ready: 'default',
    expired: 'outline',
    failed: 'destructive',
  });

export function DataExportStatusBadge({ status }: DataExportStatusBadgeProps) {
  const displayStatus = DISPLAY_STATUS_OF[status];
  return (
    <Badge variant={VARIANT_OF[displayStatus]}>
      {DATA_EXPORT_DISPLAY_STATUS_LABELS[displayStatus]}
    </Badge>
  );
}
