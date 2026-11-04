import {
  LEGAL_DOCUMENT_EXTERNAL_LINK_REL,
  legalRevisionPath,
} from '../../../common-lib/legal/legal-documents.ts';
import { DateTime } from '../../../lib/components/datetime/date-time.tsx';
import { MarkdownContent } from '../../../lib/components/markdown/markdown-content.tsx';
import { useMarkdownOptions } from '../../../lib/components/markdown/use-markdown-options.ts';
import { useRenderedMarkdown } from '../../../lib/components/markdown/use-rendered-markdown.ts';
import { Button } from '../../../lib/components/ui/button/button.tsx';
import type { AdminLegalVersionView } from '../../graphql/admin-legal-documents.ts';
import { legalVersionLabel } from './legal-documents-messages.ts';
import { DELETED_ADMIN_LABEL } from './legal-editor-messages.ts';
import {
  LEGAL_REVISION_COLUMNS,
  VIEW_ON_PUBLIC_PAGE_LABEL,
} from './legal-revision-messages.ts';
import { useClientSiteHref } from './use-client-site-href.ts';

export interface LegalVersionDetailProps {
  readonly version: AdminLegalVersionView;
}

export function LegalVersionDetail({ version }: LegalVersionDetailProps) {
  const clientSiteHref = useClientSiteHref();
  const options = useMarkdownOptions({
    externalLinkRel: LEGAL_DOCUMENT_EXTERNAL_LINK_REL,
  });
  const rendered = useRenderedMarkdown(version.body, options);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4 text-sm sm:flex-row sm:items-start sm:justify-between">
        <dl className="grid min-w-0 grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          <dt className="text-muted-foreground">
            {LEGAL_REVISION_COLUMNS.version}
          </dt>
          <dd>{legalVersionLabel(version.versionNumber)}</dd>
          <dt className="text-muted-foreground">
            {LEGAL_REVISION_COLUMNS.publishedAt}
          </dt>
          <dd>
            <DateTime value={version.publishedAt} format="longDateTime" />
          </dd>
          <dt className="text-muted-foreground">
            {LEGAL_REVISION_COLUMNS.changeSummary}
          </dt>
          <dd className="wrap-anywhere">{version.changeSummary}</dd>
          <dt className="text-muted-foreground">
            {LEGAL_REVISION_COLUMNS.publishedBy}
          </dt>
          <dd className="wrap-anywhere">
            {version.publishedBy.nickname ?? DELETED_ADMIN_LABEL}
          </dd>
        </dl>
        <Button asChild variant="outline" size="sm" className="self-start">
          <a
            href={clientSiteHref(
              legalRevisionPath(version.kind, version.versionNumber),
            )}
          >
            {VIEW_ON_PUBLIC_PAGE_LABEL}
          </a>
        </Button>
      </div>
      <MarkdownContent
        rendered={rendered}
        className="rounded-lg border border-border bg-card p-6"
      />
    </div>
  );
}
