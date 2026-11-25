import { Link } from '@tanstack/react-router';
import { ExternalLinkIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { REPORT_TARGET_KIND_LABELS } from '../../../../common-lib/reporting/report-labels.ts';
import { Button } from '../../../../lib/components/ui/button/button.tsx';
import type { ReportTargetView } from '../../../graphql/admin-reporting-cases.ts';
import { useClientSiteHref } from '../../layout/use-client-site-href.ts';
import { reportTargetLabelOf } from '../shared/report-messages.ts';
import { REPORT_CASE_DETAIL_COPY } from './report-case-messages.ts';
import { ReportCaseSection } from './report-case-section.tsx';

export interface ReportCaseTargetSectionProps {
  readonly target: ReportTargetView;
}

// 利用者側のページのパス。表示できない対象と、ハンドルを持たない対象には示さない
const clientPathOf = ({
  kind,
  available,
  handle,
  productHandle,
}: ReportTargetView): string | undefined => {
  if (!available) {
    return undefined;
  }
  if (kind === 'user') {
    return handle === null ? undefined : `/@${handle}`;
  }
  const product = kind === 'product' ? handle : productHandle;
  return product === null ? undefined : `/p/${product}`;
};

const LINK_CLASS_NAME = 'self-start';

// UGC管理の画面への導線。ユーザーとコメントは一覧の絞り込みで対象を開く
function AdminPageLink({ target }: { readonly target: ReportTargetView }) {
  if (!target.available) {
    return null;
  }
  const label = REPORT_CASE_DETAIL_COPY.openAdminPage;
  const wrap = (link: ReactNode) => (
    <Button asChild variant="outline" size="sm" className={LINK_CLASS_NAME}>
      {link}
    </Button>
  );
  switch (target.kind) {
    case 'product': {
      return target.id === null
        ? null
        : wrap(
            <Link to="/products/$productId" params={{ productId: target.id }}>
              {label}
            </Link>,
          );
    }
    case 'user': {
      return target.handle === null
        ? null
        : wrap(
            <Link to="/users" search={{ handle: target.handle }}>
              {label}
            </Link>,
          );
    }
    case 'comment': {
      return target.productHandle === null
        ? null
        : wrap(
            <Link
              to="/comments"
              search={{ productHandle: target.productHandle }}
            >
              {label}
            </Link>,
          );
    }
  }
}

// 対象の種類と表示、利用者側のページとUGC管理の画面への導線を示す。抜粋は利用者の入力のため、マークダウンやHTMLとして解釈せず改行を保った文字列で示す
export function ReportCaseTargetSection({
  target,
}: ReportCaseTargetSectionProps) {
  const clientSiteHref = useClientSiteHref();
  const clientPath = clientPathOf(target);
  const excerpt =
    target.kind === 'comment' && target.available ? target.excerpt : null;

  return (
    <ReportCaseSection title={REPORT_CASE_DETAIL_COPY.sections.target}>
      <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
        <dt className="text-muted-foreground">
          {REPORT_CASE_DETAIL_COPY.items.targetKind}
        </dt>
        <dd>{REPORT_TARGET_KIND_LABELS[target.kind]}</dd>
      </dl>
      <p className="font-bold break-words">{reportTargetLabelOf(target)}</p>
      {excerpt === null || excerpt === '' ? null : (
        <p
          data-slot="report-target-excerpt"
          className="rounded-md border border-border p-3 text-sm break-words whitespace-pre-wrap"
        >
          {excerpt}
        </p>
      )}
      {target.detached ? null : (
        <div className="flex flex-wrap gap-2">
          {clientPath === undefined ? null : (
            <Button
              asChild
              variant="outline"
              size="sm"
              className={LINK_CLASS_NAME}
            >
              <a href={clientSiteHref(clientPath)}>
                <ExternalLinkIcon aria-hidden="true" />
                {REPORT_CASE_DETAIL_COPY.openClientPage}
              </a>
            </Button>
          )}
          <AdminPageLink target={target} />
        </div>
      )}
    </ReportCaseSection>
  );
}
