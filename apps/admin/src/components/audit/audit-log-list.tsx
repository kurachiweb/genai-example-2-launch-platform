import { useId, useRef } from 'react';

import type { AuditTargetKind } from '../../../common-lib/admin/audit-action.ts';
import {
  AdminDataTable,
  type AdminDataTableColumn,
  type AdminDataTablePagination,
} from '../../../lib/components/admin/admin-data-table.tsx';
import { DateTime } from '../../../lib/components/datetime/date-time.tsx';
import type { AuditLogEntry } from '../../graphql/admin-audit-logs.ts';
import {
  AUDIT_LOG_COLUMNS,
  AUDIT_LOG_EMPTY_MESSAGE,
  AUDIT_LOG_LIST_CAPTION,
  AUDIT_TARGET_KIND_LABELS,
  deletedOperatorLabel,
  NONE_LABEL,
} from './audit-logs-messages.ts';

export interface AuditLogListProps {
  // undefinedは読み込み中
  readonly entries: readonly AuditLogEntry[] | undefined;
  readonly error?: { readonly message: string; readonly onRetry: () => void };
  readonly pagination: AdminDataTablePagination;
}

const KNOWN_TARGET_KINDS: ReadonlySet<string> = new Set(
  Object.keys(AUDIT_TARGET_KIND_LABELS),
);

const isKnownTargetKind = (kind: string): kind is AuditTargetKind =>
  KNOWN_TARGET_KINDS.has(kind);

// 後続specが加えた対象の種類の表示名が無くても記録を示せるよう、表示名が無ければ種類の名前で示す
const targetKindLabelOf = (kind: string): string =>
  isKnownTargetKind(kind) ? AUDIT_TARGET_KIND_LABELS[kind] : kind;

const NONE = <span className="text-muted-foreground">{NONE_LABEL}</span>;

function TargetCell({ entry }: { readonly entry: AuditLogEntry }) {
  if (entry.targetKind === null || entry.targetIds.length === 0) {
    return NONE;
  }
  return (
    <div className="flex flex-col gap-1">
      <span>{targetKindLabelOf(entry.targetKind)}</span>
      <ul className="flex flex-col gap-0.5">
        {entry.targetIds.map((id) => (
          <li key={id} className="font-mono text-xs break-all">
            {id}
          </li>
        ))}
      </ul>
    </div>
  );
}

const COLUMNS: readonly AdminDataTableColumn<AuditLogEntry>[] = [
  {
    key: 'occurredAt',
    header: AUDIT_LOG_COLUMNS.occurredAt,
    cell: (entry) => (
      <DateTime value={entry.occurredAt} format="longDateTime" />
    ),
    className: 'whitespace-nowrap',
  },
  {
    key: 'operator',
    header: AUDIT_LOG_COLUMNS.operator,
    cell: ({ operator }) =>
      operator.nickname ?? (
        <span className="break-all text-muted-foreground">
          {deletedOperatorLabel(operator.id)}
        </span>
      ),
  },
  {
    key: 'action',
    header: AUDIT_LOG_COLUMNS.action,
    cell: (entry) => entry.actionLabel,
  },
  {
    key: 'target',
    header: AUDIT_LOG_COLUMNS.target,
    cell: (entry) => <TargetCell entry={entry} />,
  },
  {
    key: 'reason',
    header: AUDIT_LOG_COLUMNS.reason,
    cell: (entry) =>
      entry.reason === null ? (
        NONE
      ) : (
        <span className="break-words whitespace-pre-wrap">{entry.reason}</span>
      ),
  },
  {
    key: 'detail',
    header: AUDIT_LOG_COLUMNS.detail,
    cell: (entry) =>
      entry.detail.length === 0 ? (
        NONE
      ) : (
        <ul className="flex flex-col gap-0.5 text-xs">
          {entry.detail.map(({ key, value }) => (
            <li key={key} className="break-all">
              {key}: {value}
            </li>
          ))}
        </ul>
      ),
  },
];

export function AuditLogList({
  entries,
  error,
  pagination,
}: AuditLogListProps) {
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4">
      {/* 再試行で消える再試行のボタンからフォーカスを<body>へ落とさないよう、移り先としてプログラムからだけフォーカスできるようにする */}
      <h2
        id={headingId}
        ref={headingRef}
        tabIndex={-1}
        className="rounded-sm text-lg font-semibold"
      >
        {AUDIT_LOG_LIST_CAPTION}
      </h2>
      <AdminDataTable
        caption={AUDIT_LOG_LIST_CAPTION}
        columns={COLUMNS}
        rows={entries}
        rowKey={(entry) => entry.id}
        {...(error === undefined
          ? {}
          : {
              error: {
                message: error.message,
                onRetry: () => {
                  headingRef.current?.focus();
                  error.onRetry();
                },
              },
            })}
        emptyMessage={AUDIT_LOG_EMPTY_MESSAGE}
        pagination={pagination}
      />
    </section>
  );
}
