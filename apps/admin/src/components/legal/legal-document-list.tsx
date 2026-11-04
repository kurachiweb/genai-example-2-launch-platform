import { Link } from '@tanstack/react-router';
import { useId, useRef } from 'react';

import {
  LEGAL_DOCUMENT_LABELS,
  LEGAL_DOCUMENT_PATHS,
} from '../../../common-lib/legal/legal-documents.ts';
import {
  AdminDataTable,
  type AdminDataTableColumn,
} from '../../../lib/components/admin/admin-data-table.tsx';
import { DateTime } from '../../../lib/components/datetime/date-time.tsx';
import { Button } from '../../../lib/components/ui/button/button.tsx';
import type { LegalDocumentSummaryView } from '../../graphql/admin-legal-documents.ts';
import {
  DRAFT_PRESENT_LABEL,
  EDIT_LEGAL_DOCUMENT_LABEL,
  editLegalDocumentName,
  LEGAL_DOCUMENT_LIST_COLUMNS,
  LEGAL_DOCUMENT_LIST_EMPTY_MESSAGE,
  LEGAL_DOCUMENT_LIST_HEADING,
  legalVersionLabel,
  NONE_LABEL,
  OPEN_PUBLIC_PAGE_LABEL,
  openPublicPageName,
  UNPUBLISHED_LABEL,
} from './legal-documents-messages.ts';
import { useClientSiteHref } from './use-client-site-href.ts';

export interface LegalDocumentListProps {
  // undefinedは読み込み中
  readonly documents: readonly LegalDocumentSummaryView[] | undefined;
  readonly error?: { readonly message: string; readonly onRetry: () => void };
}

const MUTED = 'text-muted-foreground';

export function LegalDocumentList({
  documents,
  error,
}: LegalDocumentListProps) {
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const clientSiteHref = useClientSiteHref();

  const columns: readonly AdminDataTableColumn<LegalDocumentSummaryView>[] = [
    {
      key: 'name',
      header: LEGAL_DOCUMENT_LIST_COLUMNS.name,
      cell: ({ kind }) => LEGAL_DOCUMENT_LABELS[kind],
      className: 'font-medium',
    },
    {
      key: 'latestVersion',
      header: LEGAL_DOCUMENT_LIST_COLUMNS.latestVersion,
      cell: ({ latestVersionNumber }) =>
        latestVersionNumber === null ? (
          <span className={MUTED}>{UNPUBLISHED_LABEL}</span>
        ) : (
          legalVersionLabel(latestVersionNumber)
        ),
      className: 'whitespace-nowrap',
    },
    {
      key: 'publishedAt',
      header: LEGAL_DOCUMENT_LIST_COLUMNS.publishedAt,
      cell: ({ latestPublishedAt }) =>
        latestPublishedAt === null ? (
          <span className={MUTED}>{NONE_LABEL}</span>
        ) : (
          <DateTime value={latestPublishedAt} format="longDateTime" />
        ),
      className: 'whitespace-nowrap',
    },
    {
      key: 'draft',
      header: LEGAL_DOCUMENT_LIST_COLUMNS.draft,
      cell: ({ hasDraft }) =>
        hasDraft ? (
          DRAFT_PRESENT_LABEL
        ) : (
          <span className={MUTED}>{NONE_LABEL}</span>
        ),
    },
    {
      key: 'actions',
      header: LEGAL_DOCUMENT_LIST_COLUMNS.actions,
      className: 'text-end',
      cell: ({ kind }) => {
        const label = LEGAL_DOCUMENT_LABELS[kind];
        return (
          <span className="flex flex-wrap justify-end gap-2">
            <Button asChild variant="outline" size="sm">
              <Link to="/legal-documents/$kind" params={{ kind }}>
                {/* 画面に見えない要素と見えている文言を並べると、名前の計算で間に空白が入るため、名前は読み上げだけの要素にまとめて持たせる */}
                <span aria-hidden="true">{EDIT_LEGAL_DOCUMENT_LABEL}</span>
                <span className="sr-only">{editLegalDocumentName(label)}</span>
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <a href={clientSiteHref(LEGAL_DOCUMENT_PATHS[kind])}>
                <span aria-hidden="true">{OPEN_PUBLIC_PAGE_LABEL}</span>
                <span className="sr-only">{openPublicPageName(label)}</span>
              </a>
            </Button>
          </span>
        );
      },
    },
  ];

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4">
      {/* 再試行で消える再試行のボタンからフォーカスを<body>へ落とさないよう、移り先としてプログラムからだけフォーカスできるようにする */}
      <h2
        id={headingId}
        ref={headingRef}
        tabIndex={-1}
        className="rounded-sm text-lg font-semibold"
      >
        {LEGAL_DOCUMENT_LIST_HEADING}
      </h2>
      <AdminDataTable
        caption={LEGAL_DOCUMENT_LIST_HEADING}
        columns={columns}
        rows={documents}
        rowKey={({ kind }) => kind}
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
        emptyMessage={LEGAL_DOCUMENT_LIST_EMPTY_MESSAGE}
      />
    </section>
  );
}
