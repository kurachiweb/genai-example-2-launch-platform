import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useRef, useState } from 'react';

import {
  ConfirmActionDialog,
  type ConfirmActionInput,
} from '../../../lib/components/admin/confirm-action-dialog.tsx';
import { formatBusinessDateWithWeekdayLabel } from '../../../common-lib/time/business-date-label.ts';
import { DateTime } from '../../../lib/components/datetime/date-time.tsx';
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
  type AdminYearFinalDateSetting,
  adminYearFinalDateSettingsQueryOptions,
} from '../../graphql/admin-year-final-date.ts';
import { AdminUpdateYearFinalDateDocument } from '../../graphql/generated/graphql.ts';
import {
  FINAL_DATE_CONFIRM_DESCRIPTION,
  FINAL_DATE_CONFIRM_LABEL,
  FINAL_DATE_LABEL,
  FINAL_DATE_LOCKED_MESSAGE,
  FINAL_DATE_NO_CHOICES_MESSAGE,
  FINAL_DATE_SAVED_MESSAGE,
  FINAL_DATE_SUBMIT_LABEL,
  FINAL_DATE_VERSION_CONFLICT_MESSAGE,
  finalDateConfirmTitleOf,
  finalDateViolationMessageOf,
  isFinalDateViolationReason,
} from './final-date-labels.ts';
import { scheduleOfChoice } from './final-date-schedule.ts';

const VALIDATION_ERROR_CODE = 'validation_error';

const FINAL_DATE_LOCKED_CODE = 'final_date_locked';

const VERSION_CONFLICT_CODE = 'version_conflict';

// 表示中の候補・期限・版が古くなったことを示す拒否。閉じた後に照会を読み直して最新の状態を見せる
const STALE_SETTING_CODES: readonly string[] = Object.freeze([
  VALIDATION_ERROR_CODE,
  FINAL_DATE_LOCKED_CODE,
  VERSION_CONFLICT_CODE,
]);

const isStaleSettingError = (error: unknown): boolean =>
  error instanceof GraphQLClientError &&
  STALE_SETTING_CODES.includes(error.code);

const failureMessageOfSetting =
  (setting: AdminYearFinalDateSetting) =>
  (error: unknown): string => {
    if (error instanceof GraphQLClientError) {
      if (error.code === FINAL_DATE_LOCKED_CODE) {
        return FINAL_DATE_LOCKED_MESSAGE;
      }
      if (error.code === VERSION_CONFLICT_CODE) {
        return FINAL_DATE_VERSION_CONFLICT_MESSAGE;
      }
      const detail = error.details?.[0];
      if (
        error.code === VALIDATION_ERROR_CODE &&
        isFinalDateViolationReason(detail?.code)
      ) {
        // 隣の年の決勝実施日は表示の後に変わり得るため、サーバーが最新の値で作った文を優先する
        return detail.message === ''
          ? finalDateViolationMessageOf(detail.code, setting)
          : detail.message;
      }
    }
    return errorMessageOf(error, ADMIN_PROFILE.contactAvailable);
  };

// 現在の決勝実施日が候補に無い年(変更期限の直前など)は、選べる最初の日を既定にする
const defaultChoiceOf = ({
  finalDate,
  choices,
}: AdminYearFinalDateSetting): string | undefined =>
  choices.includes(finalDate) ? finalDate : choices[0];

interface FinalDateTextProps {
  readonly date: string;
}

function FinalDateText({ date }: FinalDateTextProps) {
  return (
    <time dateTime={date}>{formatBusinessDateWithWeekdayLabel(date)}</time>
  );
}

export interface FinalDateFormProps {
  readonly setting: AdminYearFinalDateSetting;
}

// 最上位管理者が変更期限より前の年の決勝実施日を、サーバーが返した候補から選んで確認の後に保存する欄
export function FinalDateForm({ setting }: FinalDateFormProps) {
  const selectId = useId();
  const queryClient = useQueryClient();
  const updateFinalDate = useMutation(
    graphqlMutationOptions(AdminUpdateYearFinalDateDocument),
  );
  // 選ぶまでは表示中の決勝実施日に従い、読み直しで候補から外れた値は捨てる
  const [selected, setSelected] = useState<string>();
  // 確認のダイアログを開いている間の保存する日付。閉じている間はundefined
  const [pendingDate, setPendingDate] = useState<string>();
  const staleRef = useRef(false);
  const { year, choices, version } = setting;
  const { queryKey } = adminYearFinalDateSettingsQueryOptions();

  const defaultChoice = defaultChoiceOf(setting);
  if (defaultChoice === undefined) {
    return (
      <p className="text-sm text-muted-foreground">
        {FINAL_DATE_NO_CHOICES_MESSAGE}
      </p>
    );
  }
  const choice =
    selected !== undefined && choices.includes(selected)
      ? selected
      : defaultChoice;
  const confirmDate = pendingDate ?? choice;
  const schedule = scheduleOfChoice(setting, confirmDate);
  const confirmTitle = finalDateConfirmTitleOf(year);

  const closeDialog = (): void => {
    setPendingDate(undefined);
    if (staleRef.current) {
      staleRef.current = false;
      void queryClient.invalidateQueries({ queryKey });
    }
  };

  const confirmSave = async ({ reason }: ConfirmActionInput): Promise<void> => {
    if (pendingDate === undefined) {
      return;
    }
    await updateFinalDate
      .mutateAsync({
        variables: {
          input: {
            year,
            finalDate: pendingDate,
            expectedVersion: version,
            reason,
          },
        },
      })
      .catch((error: unknown) => {
        if (isStaleSettingError(error)) {
          staleRef.current = true;
        }
        throw error;
      });
    setSelected(undefined);
    await queryClient.invalidateQueries({ queryKey });
    notify.success(FINAL_DATE_SAVED_MESSAGE);
  };

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex min-w-52 flex-col gap-2">
        <Label htmlFor={selectId}>{FINAL_DATE_LABEL}</Label>
        <Select value={choice} onValueChange={setSelected}>
          <SelectTrigger id={selectId} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {choices.map((date) => (
              <SelectItem key={date} value={date}>
                <FinalDateText date={date} />
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Button
        type="button"
        onClick={() => {
          setPendingDate(choice);
        }}
      >
        {FINAL_DATE_SUBMIT_LABEL}
      </Button>
      <ConfirmActionDialog
        open={pendingDate !== undefined}
        onOpenChange={(open) => {
          if (!open) {
            closeDialog();
          }
        }}
        title={
          <>
            {confirmTitle.before}
            <FinalDateText date={confirmDate} />
            {confirmTitle.after}
          </>
        }
        description={
          <>
            {FINAL_DATE_CONFIRM_DESCRIPTION.beforeAcceptUntil}
            <DateTime value={schedule.acceptUntil} format="longDateTime" />
            {FINAL_DATE_CONFIRM_DESCRIPTION.beforeDrawAt}
            <DateTime value={schedule.drawAt} format="longDateTime" />
            {FINAL_DATE_CONFIRM_DESCRIPTION.after}
          </>
        }
        confirmLabel={FINAL_DATE_CONFIRM_LABEL}
        reason="optional"
        audited
        onConfirm={confirmSave}
        failureMessageOf={failureMessageOfSetting(setting)}
      />
    </div>
  );
}
