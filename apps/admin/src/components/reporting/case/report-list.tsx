import { DateTime } from '../../../../lib/components/datetime/date-time.tsx';
import type {
  ReporterView,
  ReportView,
} from '../../../graphql/admin-reporting-cases.ts';
import { UNREADABLE_USER_LABEL } from '../../moderation/shared/moderation-messages.ts';
import {
  REPORT_CASE_DETAIL_COPY,
  REPORT_LIST_COPY,
} from './report-case-messages.ts';
import { ReportCaseSection } from './report-case-section.tsx';

export interface ReportListProps {
  // 受付日時の昇順
  readonly reports: readonly ReportView[];
}

const TERM_CLASS_NAME = 'text-muted-foreground';

const memberLabelOf = ({ nickname, handle }: ReporterView): string => {
  const name = nickname ?? UNREADABLE_USER_LABEL;
  return handle === null ? name : `${name}(@${handle})`;
};

// 未ログインの通報者は連絡先メールアドレスを示さず、有無だけを示す。停止中の利用者の通報も未ログインとして記録される
const reporterLabelOf = (reporter: ReporterView): string =>
  reporter.kind === 'member'
    ? memberLabelOf(reporter)
    : `${REPORT_LIST_COPY.guest} ${reporter.hasContact ? REPORT_LIST_COPY.withContact : REPORT_LIST_COPY.withoutContact}`;

// 案件の通報を受付日時の古い順に示す。理由は利用者の入力のため、マークダウンやHTMLとして解釈せず改行を保った文字列で示す
export function ReportList({ reports }: ReportListProps) {
  const { items } = REPORT_LIST_COPY;
  return (
    <ReportCaseSection title={REPORT_CASE_DETAIL_COPY.sections.reports}>
      {reports.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {REPORT_LIST_COPY.empty}
        </p>
      ) : (
        <ol aria-label={REPORT_LIST_COPY.label} className="flex flex-col gap-3">
          {reports.map((report) => (
            <li
              key={report.id}
              className="rounded-md border border-border p-3 text-sm"
            >
              <dl className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-[auto_1fr]">
                <dt className={TERM_CLASS_NAME}>{items.category}</dt>
                <dd>{report.categoryName}</dd>
                <dt className={TERM_CLASS_NAME}>{items.reason}</dt>
                <dd className="break-words whitespace-pre-wrap">
                  {report.reason}
                </dd>
                <dt className={TERM_CLASS_NAME}>{items.reportedAt}</dt>
                <dd>
                  <DateTime value={report.reportedAt} format="longDateTime" />
                </dd>
                <dt className={TERM_CLASS_NAME}>{items.reporter}</dt>
                <dd className="break-words">
                  {reporterLabelOf(report.reporter)}
                </dd>
              </dl>
            </li>
          ))}
        </ol>
      )}
    </ReportCaseSection>
  );
}
