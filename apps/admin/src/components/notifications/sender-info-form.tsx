import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import type { SenderInfoField } from '../../../common-lib/notifications/sender-info-input-rules.ts';
import {
  ConfirmActionDialog,
  type ConfirmActionInput,
} from '../../../lib/components/admin/confirm-action-dialog.tsx';
import { notify } from '../../../lib/components/feedback/notify.ts';
import { AppForm } from '../../../lib/components/form/app-form.tsx';
import { FormField } from '../../../lib/components/form/form-field.tsx';
import { FormMessage } from '../../../lib/components/form/form-message.tsx';
import { SubmitButton } from '../../../lib/components/form/submit-button.tsx';
import { useAppForm } from '../../../lib/components/form/use-app-form.ts';
import { Input } from '../../../lib/components/ui/input/input.tsx';
import { graphqlMutationOptions } from '../../../lib/start/graphql/graphql-query-options.ts';
import {
  errorMessageOf,
  GraphQLClientError,
} from '../../../lib/utilities/graphql/graphql-result.ts';
import { ADMIN_PROFILE } from '../../composition/app-profile.ts';
import { invalidateAuditLogQueries } from '../../graphql/admin-audit-logs.ts';
import {
  type AdminNotificationSenderInfoState,
  adminNotificationSenderInfoQueryOptions,
} from '../../graphql/admin-notification-sender-info.ts';
import {
  type AdminNotificationSenderInfoQuery,
  AdminUpdateNotificationSenderInfoDocument,
  type UpdateNotificationSenderInfoInput,
} from '../../graphql/generated/graphql.ts';
import {
  SENDER_INFO_FORM_SCHEMA,
  type SenderInfoFormInput,
  type SenderInfoFormOutput,
} from './sender-info-form-schema.ts';
import {
  SENDER_INFO_CONFIRM_DESCRIPTION,
  SENDER_INFO_CONFIRM_LABEL,
  SENDER_INFO_CONFIRM_TITLE,
  SENDER_INFO_SAVED_MESSAGE,
  SENDER_INFO_SUBMIT_LABEL,
  senderInfoFieldLabelOf,
} from './sender-info-messages.ts';

const SERVER_FIELD_PREFIX = 'input';

const REASON_FIELD = `${SERVER_FIELD_PREFIX}.reason`;

const VERSION_CONFLICT_CODE = 'version_conflict';

const VALIDATION_ERROR_CODE = 'validation_error';

const SENDER_INFO_FIELDS: readonly SenderInfoField[] = Object.freeze([
  'businessName',
  'contactEmail',
  'postalAddress',
]);

const FIELD_AUTO_COMPLETE = 'off';

const failureMessageOf = (error: unknown): string =>
  errorMessageOf(error, ADMIN_PROFILE.contactAvailable);

const defaultValuesOf = (
  info: AdminNotificationSenderInfoState['info'],
): SenderInfoFormInput => ({
  businessName: info?.businessName ?? '',
  contactEmail: info?.contactEmail ?? '',
  postalAddress: info?.postalAddress ?? '',
});

const isValidationError = (error: unknown): error is GraphQLClientError =>
  error instanceof GraphQLClientError && error.code === VALIDATION_ERROR_CODE;

// 確認のダイアログの理由の欄は、ダイアログのフォームの欄の名前(reason)で詳細を受け取る
const withDialogFieldNames = (error: GraphQLClientError): GraphQLClientError =>
  new GraphQLClientError(
    {
      code: error.code,
      message: error.message,
      status: error.status,
      details: error.details?.map((detail) =>
        detail.field === REASON_FIELD ? { ...detail, field: 'reason' } : detail,
      ),
      retryAfterSeconds: error.retryAfterSeconds,
    },
    { cause: error },
  );

const firstInvalidFieldOf = (
  error: GraphQLClientError,
): SenderInfoField | undefined =>
  SENDER_INFO_FIELDS.find((field) =>
    error.details?.some(
      (detail) => detail.field === `${SERVER_FIELD_PREFIX}.${field}`,
    ),
  );

// 保存の確定。成功した値で照会のキャッシュを置き換えて監査ログに残る保存の後に監査ログの照会を無効にし、競合で拒否された時はダイアログを閉じた後に最新の値が見えるよう読み直す
function useSenderInfoSave() {
  const queryClient = useQueryClient();
  const { queryKey } = adminNotificationSenderInfoQueryOptions();
  const updateSenderInfo = useMutation(
    graphqlMutationOptions(AdminUpdateNotificationSenderInfoDocument),
  );
  return async (input: UpdateNotificationSenderInfoInput): Promise<void> => {
    const { updateNotificationSenderInfo } = await updateSenderInfo
      .mutateAsync({ variables: { input } })
      .catch(async (error: unknown) => {
        if (
          error instanceof GraphQLClientError &&
          error.code === VERSION_CONFLICT_CODE
        ) {
          await queryClient.invalidateQueries({ queryKey });
        }
        throw error;
      });
    queryClient.setQueryData<AdminNotificationSenderInfoQuery>(queryKey, {
      notificationSenderInfo: updateNotificationSenderInfo,
    });
    notify.success(SENDER_INFO_SAVED_MESSAGE);
    await invalidateAuditLogQueries(queryClient);
  };
}

interface PendingSave {
  readonly values: SenderInfoFormOutput;
  // 送信した時に読み込んでいた版。競合の後に読み直した版で送り直すと、確かめていない最新の値を上書きするため使わない
  readonly expectedVersion: number;
  readonly settle: (error?: GraphQLClientError) => void;
}

export interface SenderInfoFormProps {
  readonly state: AdminNotificationSenderInfoState;
}

// 最上位管理者が送信者情報を編集する入力欄。入力欄のフォームの送信は確認のダイアログを開き、確定か取り消しで閉じるまで送信中のままにする
export function SenderInfoForm({ state }: SenderInfoFormProps) {
  const form = useAppForm(SENDER_INFO_FORM_SCHEMA, {
    defaultValues: defaultValuesOf(state.info),
  });
  const saveSenderInfo = useSenderInfoSave();
  const [pendingSave, setPendingSave] = useState<PendingSave>();
  const [formError, setFormError] = useState<string>();
  // 項目の違反でダイアログを閉じる時に、入力欄のフォームの送信をその例外で拒否するために持つ
  const rejectionRef = useRef<GraphQLClientError>(undefined);
  // 項目の違反でダイアログを閉じた後のフォーカスの移り先。無ければダイアログを開いた保存のボタンへ戻る
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const fieldsRef = useRef<HTMLDivElement>(null);
  const loadedVersionRef = useRef(state.version);
  const { reset } = form;
  const { version, info } = state;

  const dialogOpen = pendingSave !== undefined;

  // 保存や競合の後の読み直しで版が変わったら、新しい値で入力を始め直す。入力の始め直しはフォームの送信中の状態も消すため、確認のダイアログを閉じて送信を終えるまで待つ
  useEffect(() => {
    if (dialogOpen || loadedVersionRef.current === version) {
      return;
    }
    loadedVersionRef.current = version;
    reset(defaultValuesOf(info));
  }, [dialogOpen, version, info, reset]);

  const closeDialog = (): void => {
    const rejection = rejectionRef.current;
    rejectionRef.current = undefined;
    pendingSave?.settle(rejection);
    setPendingSave(undefined);
  };

  const confirmSave = async ({ reason }: ConfirmActionInput): Promise<void> => {
    if (pendingSave === undefined) {
      return;
    }
    const { values, expectedVersion } = pendingSave;
    try {
      await saveSenderInfo({ ...values, expectedVersion, reason });
    } catch (error) {
      if (!isValidationError(error)) {
        throw error;
      }
      if (error.details?.some(({ field }) => field === REASON_FIELD) === true) {
        throw withDialogFieldNames(error);
      }
      // 項目の違反は例外を投げずにダイアログを閉じ、入力欄のフォームの欄に詳細を付けさせる
      rejectionRef.current = error;
      const field = firstInvalidFieldOf(error);
      returnFocusRef.current =
        field === undefined
          ? null
          : (fieldsRef.current?.querySelector<HTMLElement>(
              `[name="${field}"]`,
            ) ?? null);
    }
  };

  return (
    <>
      <AppForm
        form={form}
        serverFieldPrefix={SERVER_FIELD_PREFIX}
        onSubmit={(values) =>
          new Promise<void>((resolve, reject) => {
            setFormError(undefined);
            returnFocusRef.current = null;
            setPendingSave({
              values,
              expectedVersion: version,
              settle: (error) => {
                if (error === undefined) {
                  resolve();
                } else {
                  reject(error);
                }
              },
            });
          })
        }
        onSubmitError={(error) => {
          setFormError(failureMessageOf(error));
        }}
        className="flex flex-col gap-4"
      >
        {formError === undefined ? null : (
          <FormMessage role="alert">{formError}</FormMessage>
        )}
        <div ref={fieldsRef} className="flex flex-col gap-4">
          {SENDER_INFO_FIELDS.map((field) => (
            <FormField
              key={field}
              control={form.control}
              name={field}
              label={senderInfoFieldLabelOf(field)}
            >
              {(control) => (
                <Input
                  {...control}
                  type="text"
                  inputMode={field === 'contactEmail' ? 'email' : undefined}
                  aria-required
                  autoComplete={FIELD_AUTO_COMPLETE}
                  spellCheck={field === 'contactEmail' ? false : undefined}
                />
              )}
            </FormField>
          ))}
        </div>
        <SubmitButton className="self-start">
          {SENDER_INFO_SUBMIT_LABEL}
        </SubmitButton>
      </AppForm>
      {/* 確認のダイアログはフォームを持ち、ポータルの中でも送信のイベントが入力欄のフォームへ伝わるため、入力欄のフォームの外に置く */}
      <ConfirmActionDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            closeDialog();
          }
        }}
        title={SENDER_INFO_CONFIRM_TITLE}
        description={SENDER_INFO_CONFIRM_DESCRIPTION}
        confirmLabel={SENDER_INFO_CONFIRM_LABEL}
        reason="optional"
        audited
        onConfirm={confirmSave}
        failureMessageOf={failureMessageOf}
        returnFocusRef={returnFocusRef}
      />
    </>
  );
}
