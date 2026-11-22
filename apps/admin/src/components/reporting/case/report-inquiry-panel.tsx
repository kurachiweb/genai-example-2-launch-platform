import { CircleAlertIcon, MailIcon } from 'lucide-react';
import { useRef, useState } from 'react';

import { DateTime } from '../../../../lib/components/datetime/date-time.tsx';
import { Button } from '../../../../lib/components/ui/button/button.tsx';
import type { ReportCaseDetailView } from '../../../graphql/admin-reporting-cases.ts';
import { RoleGate } from '../../layout/role-gate.tsx';
import { InfringementInquiryDialog } from './infringement-inquiry-dialog.tsx';
import {
  REPORT_CASE_DETAIL_COPY,
  REPORT_INQUIRY_COPY,
} from './report-case-messages.ts';
import { ReportCaseSection } from './report-case-section.tsx';

export interface ReportInquiryPanelProps {
  readonly detail: ReportCaseDetailView;
}

const TERM_CLASS_NAME = 'text-muted-foreground';

// 権利侵害の案件の最後の照会と回答の期限を示し、期限の超過は色だけに頼らず文言でも示す。照会の内容は管理者の入力のため改行を保った文字列で示す
export function ReportInquiryPanel({ detail }: ReportInquiryPanelProps) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const { lastInquiry, case: reportCase } = detail;
  // 照会できるかはAPIサーバーが投稿者の宛先と利用者側のURLまで確かめて返す
  const inquiryAvailable =
    detail.inquiryAvailable && reportCase.status === 'in_progress';

  return (
    <ReportCaseSection
      title={REPORT_CASE_DETAIL_COPY.sections.inquiry}
      headingRef={headingRef}
    >
      {lastInquiry === null ? (
        <p className="text-sm text-muted-foreground">
          {REPORT_INQUIRY_COPY.none}
        </p>
      ) : (
        <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
          <dt className={TERM_CLASS_NAME}>{REPORT_INQUIRY_COPY.lastInquiry}</dt>
          <dd>
            <DateTime value={lastInquiry.sentAt} format="longDateTime" />
          </dd>
          <dt className={TERM_CLASS_NAME}>{REPORT_INQUIRY_COPY.message}</dt>
          <dd className="break-words whitespace-pre-wrap">
            {lastInquiry.message}
          </dd>
          <dt className={TERM_CLASS_NAME}>{REPORT_INQUIRY_COPY.deadline}</dt>
          <dd className="flex flex-col gap-1">
            <DateTime value={lastInquiry.deadline} format="longDateTime" />
            {lastInquiry.overdue ? (
              <span className="flex items-start gap-1 font-semibold text-destructive">
                <CircleAlertIcon
                  aria-hidden="true"
                  className="mt-0.5 size-4 shrink-0"
                />
                {REPORT_INQUIRY_COPY.overdue}
              </span>
            ) : null}
          </dd>
        </dl>
      )}
      {inquiryAvailable ? (
        <RoleGate minimum="moderator">
          <Button
            ref={buttonRef}
            type="button"
            variant="outline"
            size="sm"
            className="self-start"
            onClick={() => {
              setOpen(true);
            }}
          >
            <MailIcon aria-hidden="true" />
            {REPORT_INQUIRY_COPY.send}
          </Button>
          <InfringementInquiryDialog
            open={open}
            onOpenChange={setOpen}
            caseId={reportCase.id}
            targetKind={reportCase.target.kind}
            returnFocusRef={buttonRef}
            fallbackFocusRef={headingRef}
          />
        </RoleGate>
      ) : null}
    </ReportCaseSection>
  );
}
