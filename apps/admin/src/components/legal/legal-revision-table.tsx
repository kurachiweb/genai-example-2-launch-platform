import { Link } from '@tanstack/react-router';
import { useId } from 'react';

import {
  type LegalDocumentKind,
  legalRevisionPath,
} from '../../../common-lib/legal/legal-documents.ts';
import {
  AdminDataTable,
  type AdminDataTableColumn,
} from '../../../lib/components/admin/admin-data-table.tsx';
import { DateTime } from '../../../lib/components/datetime/date-time.tsx';
import { Button } from '../../../lib/components/ui/button/button.tsx';
import type { AdminLegalRevisionView } from '../../graphql/admin-legal-documents.ts';
import { legalVersionLabel } from './legal-documents-messages.ts';
import { DELETED_ADMIN_LABEL } from './legal-editor-messages.ts';
import {
  LEGAL_REVISION_COLUMNS,
  LEGAL_REVISION_TABLE_EMPTY_MESSAGE,
  LEGAL_REVISION_TABLE_HEADING,
  SHOW_VERSION_LABEL,
  showVersionName,
  VIEW_ON_PUBLIC_PAGE_LABEL,
  viewVersionOnPublicPageName,
} from './legal-revision-messages.ts';
import { useClientSiteHref } from './use-client-site-href.ts';

export interface LegalRevisionTableProps {
  readonly kind: LegalDocumentKind;
  // 新しい順
  readonly revisions: readonly AdminLegalRevisionView[];
}

export function LegalRevisionTable({
  kind,
  revisions,
}: LegalRevisionTableProps) {
  const headingId = useId();
  const clientSiteHref = useClientSiteHref();

  const columns: readonly AdminDataTableColumn<AdminLegalRevisionView>[] = [
    {
      key: 'version',
      header: LEGAL_REVISION_COLUMNS.version,
      cell: ({ versionNumber }) => legalVersionLabel(versionNumber),
      className: 'font-medium whitespace-nowrap',
    },
    {
      key: 'publishedAt',
      header: LEGAL_REVISION_COLUMNS.publishedAt,
      cell: ({ publishedAt }) => (
        <DateTime value={publishedAt} format="longDateTime" />
      ),
      className: 'whitespace-nowrap',
    },
    {
      key: 'changeSummary',
      header: LEGAL_REVISION_COLUMNS.changeSummary,
      cell: ({ changeSummary }) => changeSummary,
      className: 'min-w-48 wrap-anywhere',
    },
    {
      key: 'publishedBy',
      header: LEGAL_REVISION_COLUMNS.publishedBy,
      cell: ({ publishedBy }) =>
        publishedBy.nickname ?? (
          <span className="text-muted-foreground">{DELETED_ADMIN_LABEL}</span>
        ),
      className: 'wrap-anywhere',
    },
    {
      key: 'actions',
      header: LEGAL_REVISION_COLUMNS.actions,
      className: 'text-end',
      cell: ({ versionNumber }) => {
        const label = legalVersionLabel(versionNumber);
        return (
          <span className="flex flex-wrap justify-end gap-2">
            <Button asChild variant="outline" size="sm">
              <Link
                to="/legal-documents/$kind/revisions/$versionNumber"
                params={{ kind, versionNumber: String(versionNumber) }}
              >
                {/* 画面に見えない要素と見えている文言を並べると、名前の計算で間に空白が入るため、名前は読み上げだけの要素にまとめて持たせる */}
                <span aria-hidden="true">{SHOW_VERSION_LABEL}</span>
                <span className="sr-only">{showVersionName(label)}</span>
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <a href={clientSiteHref(legalRevisionPath(kind, versionNumber))}>
                <span aria-hidden="true">{VIEW_ON_PUBLIC_PAGE_LABEL}</span>
                <span className="sr-only">
                  {viewVersionOnPublicPageName(label)}
                </span>
              </a>
            </Button>
          </span>
        );
      },
    },
  ];

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4">
      <h2 id={headingId} className="text-lg font-semibold">
        {LEGAL_REVISION_TABLE_HEADING}
      </h2>
      <AdminDataTable
        caption={LEGAL_REVISION_TABLE_HEADING}
        columns={columns}
        rows={revisions}
        rowKey={({ versionNumber }) => String(versionNumber)}
        emptyMessage={LEGAL_REVISION_TABLE_EMPTY_MESSAGE}
      />
    </section>
  );
}
