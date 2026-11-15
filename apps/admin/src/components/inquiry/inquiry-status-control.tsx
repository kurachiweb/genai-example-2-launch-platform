import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useRef, useState } from 'react';

import {
  INQUIRY_STATUS_LABELS,
  INQUIRY_STATUSES,
  type InquiryStatus,
} from '../../../common-lib/inquiry/inquiry-status.ts';
import { ConfirmActionDialog } from '../../../lib/components/admin/confirm-action-dialog.tsx';
import { notify } from '../../../lib/components/feedback/notify.ts';
import { Button } from '../../../lib/components/ui/button/button.tsx';
import { Label } from '../../../lib/components/ui/label/label.tsx';
import { Select } from '../../../lib/components/ui/select/select.tsx';
import { SelectContent } from '../../../lib/components/ui/select/select-content.tsx';
import { SelectItem } from '../../../lib/components/ui/select/select-item.tsx';
import { SelectTrigger } from '../../../lib/components/ui/select/select-trigger.tsx';
import { SelectValue } from '../../../lib/components/ui/select/select-value.tsx';
import { graphqlMutationOptions } from '../../../lib/start/graphql/graphql-query-options.ts';
import {
  errorMessageOf,
  GraphQLClientError,
} from '../../../lib/utilities/graphql/graphql-result.ts';
import { ADMIN_PROFILE } from '../../composition/app-profile.ts';
import {
  adminInquiryQueryOptions,
  GRAPHQL_INQUIRY_STATUS_OF,
  markInquirySummariesStale,
  withChangedInquiryStatus,
} from '../../graphql/admin-inquiries.ts';
import {
  AdminChangeInquiryStatusDocument,
  type AdminInquiryQuery,
} from '../../graphql/generated/graphql.ts';
import {
  CHANGE_STATUS_CONFIRM_LABEL,
  CHANGE_STATUS_LABEL,
  changeStatusDescription,
  changeStatusTitle,
  NEXT_STATUS_LABEL,
  STATUS_CHANGED_MESSAGE,
  STATUS_SECTION_TITLE,
} from './inquiry-operations-messages.ts';

export interface InquiryStatusControlProps {
  readonly inquiryId: string;
  readonly status: InquiryStatus;
}

const VALIDATION_ERROR_CODE = 'validation_error';

const STATUS_FIELD = 'status';

const STATE_CONFLICT_CODE = 'inquiry_state_conflict';

const isStateConflict = (error: unknown): boolean =>
  error instanceof GraphQLClientError && error.code === STATE_CONFLICT_CODE;

const isInquiryStatus = (value: string): value is InquiryStatus =>
  (INQUIRY_STATUSES as readonly string[]).includes(value);

// 選択欄はステータスの欄を持たないため、他の管理者が先に同じ値へ変えた時の拒否は、共通の文言ではなく欄の詳細の文言で示す
const failureMessageOf = (error: unknown): string => {
  if (
    error instanceof GraphQLClientError &&
    error.code === VALIDATION_ERROR_CODE
  ) {
    const detail = error.details?.find(({ field }) => field === STATUS_FIELD);
    if (detail !== undefined) {
      return detail.message;
    }
  }
  return errorMessageOf(error, ADMIN_PROFILE.contactAvailable);
};

export function InquiryStatusControl({
  inquiryId,
  status,
}: InquiryStatusControlProps) {
  const headingId = useId();
  const selectId = useId();
  // 選ぶまでは表示中のステータスに従い、取り直しで変わった値も示す
  const [selected, setSelected] = useState<InquiryStatus>();
  const [confirmOpen, setConfirmOpen] = useState(false);
  // 変更に成功すると開いた元のボタンが押せなくなるため、閉じた後は選択欄へフォーカスを戻す
  const selectRef = useRef<HTMLButtonElement>(null);
  const queryClient = useQueryClient();
  const changeStatus = useMutation(
    graphqlMutationOptions(AdminChangeInquiryStatusDocument),
  );
  const [buttonFocused, setButtonFocused] = useState(false);
  const nextStatus = selected ?? status;
  const unchanged = nextStatus === status;
  const detailKey = adminInquiryQueryOptions(inquiryId).queryKey;

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4">
      <h2 id={headingId} className="text-lg font-semibold">
        {STATUS_SECTION_TITLE}
      </h2>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-44 flex-col gap-2">
          <Label htmlFor={selectId}>{NEXT_STATUS_LABEL}</Label>
          <Select
            value={nextStatus}
            onValueChange={(value) => {
              if (isInquiryStatus(value)) {
                setSelected(value);
              }
            }}
          >
            <SelectTrigger ref={selectRef} id={selectId} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {INQUIRY_STATUSES.map((value) => (
                <SelectItem key={value} value={value}>
                  {INQUIRY_STATUS_LABELS[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {/* 押せない間はTabの停止位置から外すが、フォーカスのある間に取り直しで押せなくなった時はdisabledにするとフォーカスが<body>へ落ちるため、離れるまでaria-disabledにする */}
        <Button
          type="button"
          variant="outline"
          disabled={unchanged && !buttonFocused}
          aria-disabled={unchanged && buttonFocused ? true : undefined}
          onFocus={() => {
            setButtonFocused(true);
          }}
          onBlur={() => {
            setButtonFocused(false);
          }}
          onClick={() => {
            if (!unchanged) {
              setConfirmOpen(true);
            }
          }}
        >
          {CHANGE_STATUS_LABEL}
        </Button>
      </div>
      <ConfirmActionDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={changeStatusTitle(INQUIRY_STATUS_LABELS[nextStatus])}
        description={changeStatusDescription(INQUIRY_STATUS_LABELS[status])}
        confirmLabel={CHANGE_STATUS_CONFIRM_LABEL}
        reason="optional"
        audited
        onConfirm={async ({ reason }) => {
          const { changeInquiryStatus } = await changeStatus
            .mutateAsync({
              variables: {
                inquiryId,
                status: GRAPHQL_INQUIRY_STATUS_OF[nextStatus],
                reason,
              },
            })
            .catch(async (error: unknown) => {
              // 未ログインの詳細は定期的に取り直さないため、他の操作が先に確定した時は表示中のステータスを最新にしてから選び直させる
              if (isStateConflict(error)) {
                await queryClient.invalidateQueries({ queryKey: detailKey });
              }
              throw error;
            });
          queryClient.setQueryData<AdminInquiryQuery>(detailKey, (data) =>
            withChangedInquiryStatus(data, changeInquiryStatus),
          );
          setSelected(undefined);
          notify.success(STATUS_CHANGED_MESSAGE);
          await markInquirySummariesStale(queryClient);
        }}
        failureMessageOf={failureMessageOf}
        returnFocusRef={selectRef}
      />
    </section>
  );
}
