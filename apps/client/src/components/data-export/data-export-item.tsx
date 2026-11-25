import { DownloadIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { DateTime } from '../../../lib/components/datetime/date-time.tsx';
import { PathLink } from '../../../lib/components/navigation/path-link.tsx';
import { Button } from '../../../lib/components/ui/button/button.tsx';
import { formatFileSize } from '../../../lib/utilities/media/file-size-label.ts';
import type { DataExportFieldsFragment } from '../../graphql/generated/graphql.ts';
import { CONTACT_HREF } from '../layout/site-links.ts';
import { DataExportStatusBadge } from './data-export-status-badge.tsx';
import {
  DATA_EXPORT_COMPLETED_AT_LABEL,
  DATA_EXPORT_CONTACT_LINK_LABEL,
  DATA_EXPORT_CONTACT_REQUEST_SUFFIX,
  DATA_EXPORT_DOWNLOAD_UNTIL_SUFFIX,
  DATA_EXPORT_EXPIRED_MESSAGE,
  DATA_EXPORT_EXPIRES_AT_LABEL,
  DATA_EXPORT_FAILED_AT_LABEL,
  DATA_EXPORT_FAILED_MESSAGE,
  DATA_EXPORT_FILE_NAME_LABEL,
  DATA_EXPORT_REQUESTED_AT_LABEL,
  DATA_EXPORT_SIZE_LABEL,
  DATA_EXPORT_TOO_LARGE_MESSAGE,
  dataExportDownloadLabel,
} from './data-export-messages.ts';

export interface DataExportItemProps {
  readonly item: DataExportFieldsFragment;
}

interface DetailRowProps {
  readonly label: string;
  readonly children: ReactNode;
}

function DetailRow({ label, children }: DetailRowProps) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="break-all">{children}</dd>
    </>
  );
}

function DateRow({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string | null;
}) {
  return value === null ? null : (
    <DetailRow label={label}>
      <DateTime value={value} format="longDateTime" />
    </DetailRow>
  );
}

function ArchiveRows({ item }: DataExportItemProps) {
  return (
    <>
      <DateRow
        label={DATA_EXPORT_COMPLETED_AT_LABEL}
        value={item.completedAt}
      />
      <DateRow label={DATA_EXPORT_EXPIRES_AT_LABEL} value={item.expiresAt} />
      {item.fileName === null ? null : (
        <DetailRow label={DATA_EXPORT_FILE_NAME_LABEL}>
          {item.fileName}
        </DetailRow>
      )}
      {item.byteSize === null ? null : (
        <DetailRow label={DATA_EXPORT_SIZE_LABEL}>
          <span className="tabular-nums">{formatFileSize(item.byteSize)}</span>
        </DetailRow>
      )}
    </>
  );
}

function ReadyAction({ item }: DataExportItemProps) {
  if (item.downloadPath === null) {
    return null;
  }
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      {item.expiresAt === null ? null : (
        <p className="text-sm">
          <DateTime value={item.expiresAt} format="longDateTime" />
          {DATA_EXPORT_DOWNLOAD_UNTIL_SUFFIX}
        </p>
      )}
      <Button asChild variant="outline" size="sm">
        <a href={item.downloadPath}>
          <DownloadIcon aria-hidden="true" />
          {dataExportDownloadLabel(
            item.byteSize === null ? null : formatFileSize(item.byteSize),
          )}
        </a>
      </Button>
    </div>
  );
}

function FailureNote({ item }: DataExportItemProps) {
  if (item.failureKind === 'TOO_LARGE') {
    return (
      <p className="text-sm">
        {DATA_EXPORT_TOO_LARGE_MESSAGE}
        <PathLink
          href={CONTACT_HREF}
          className="text-primary underline underline-offset-4"
        >
          {DATA_EXPORT_CONTACT_LINK_LABEL}
        </PathLink>
        {DATA_EXPORT_CONTACT_REQUEST_SUFFIX}
      </p>
    );
  }
  return <p className="text-sm">{DATA_EXPORT_FAILED_MESSAGE}</p>;
}

function StatusDetails({ item }: DataExportItemProps) {
  switch (item.status) {
    case 'PENDING':
      return null;
    case 'READY':
      return <ReadyAction item={item} />;
    case 'EXPIRED':
      return <p className="text-sm">{DATA_EXPORT_EXPIRED_MESSAGE}</p>;
    case 'FAILED':
      return <FailureNote item={item} />;
  }
}

// 要求日時と状態のバッジを示し、状態に応じて完了日時から大きさまでの項目・ダウンロードのリンク・失敗や期限切れの案内を添える
export function DataExportItem({ item }: DataExportItemProps) {
  const hasArchive = item.status === 'READY' || item.status === 'EXPIRED';
  return (
    // 続きを読み込んだ後に、加えた最初の項目へフォーカスを移せるよう、プログラムからだけフォーカスできるようにする
    <li
      tabIndex={-1}
      className="flex flex-col gap-3 rounded-xl border border-border bg-card px-4 py-3 text-card-foreground"
    >
      <div>
        <DataExportStatusBadge status={item.status} />
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <DateRow
          label={DATA_EXPORT_REQUESTED_AT_LABEL}
          value={item.requestedAt}
        />
        {hasArchive ? <ArchiveRows item={item} /> : null}
        {item.status === 'FAILED' ? (
          <DateRow label={DATA_EXPORT_FAILED_AT_LABEL} value={item.failedAt} />
        ) : null}
      </dl>
      <StatusDetails item={item} />
    </li>
  );
}
