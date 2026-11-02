import { useEffect, useState } from 'react';

import { AppForm } from '../../../lib/components/form/app-form.tsx';
import { FormMessage } from '../../../lib/components/form/form-message.tsx';
import { SubmitButton } from '../../../lib/components/form/submit-button.tsx';
import { useAppForm } from '../../../lib/components/form/use-app-form.ts';
import type { ButtonVariant } from '../../../lib/components/ui/button/button-variants.ts';
import {
  REAUTHENTICATION_FORM_SCHEMAS,
  type ReauthenticationFormInput,
  type ReauthenticationFormValues,
} from '../auth/account-form-schemas.ts';
import {
  type ReauthenticationFieldNames,
  ReauthenticationFields,
} from './reauthentication-fields.tsx';
import { useReauthenticationMode } from './use-reauthentication-mode.ts';
import { useReauthenticationSubmitError } from './use-reauthentication-submit-error.ts';

export interface ReauthenticatedActionFormProps {
  readonly label: string;
  readonly submitLabel: string;
  readonly submitVariant?: ButtonVariant;
  readonly totpEnabled: boolean;
  readonly disabled: boolean;
  readonly onSubmit: (input: ReauthenticationFormValues) => Promise<void>;
}

const DEFAULT_VALUES: ReauthenticationFormInput = Object.freeze({
  currentPassword: '',
  secondFactor: { totpCode: '', recoveryCode: '' },
});

const FIELD_NAMES: ReauthenticationFieldNames<ReauthenticationFormInput> =
  Object.freeze({
    current: 'currentPassword',
    totpCode: 'secondFactor.totpCode',
    recoveryCode: 'secondFactor.recoveryCode',
  });

// 本人確認だけを入力に取る操作のフォーム。成功の後の表示は呼び出し側が受け持つ
export function ReauthenticatedActionForm({
  label,
  submitLabel,
  submitVariant,
  totpEnabled,
  disabled,
  onSubmit,
}: ReauthenticatedActionFormProps) {
  const { mode, toggleSecondFactor } = useReauthenticationMode(totpEnabled);
  const form = useAppForm(REAUTHENTICATION_FORM_SCHEMAS[mode], {
    defaultValues: DEFAULT_VALUES,
  });
  const { submitError, clearSubmitError, onSubmitError } =
    useReauthenticationSubmitError();
  const [sentCount, setSentCount] = useState(0);
  const { reset } = form;

  // 送信の処理の中で値を戻すと送信の完了の状態の更新と重なるため、送信できた後に戻す
  useEffect(() => {
    if (sentCount > 0) {
      reset(DEFAULT_VALUES);
    }
  }, [sentCount, reset]);

  return (
    <AppForm
      form={form}
      aria-label={label}
      serverFieldPrefix="input"
      onSubmit={async (input) => {
        clearSubmitError();
        await onSubmit(input);
        setSentCount((count) => count + 1);
      }}
      onSubmitError={onSubmitError}
      className="flex flex-col gap-5"
    >
      {submitError === undefined ? null : (
        <FormMessage role="alert">{submitError}</FormMessage>
      )}
      <ReauthenticationFields
        control={form.control}
        names={FIELD_NAMES}
        mode={mode}
        onToggleSecondFactor={toggleSecondFactor}
        disabled={disabled}
      />
      <SubmitButton
        className="self-start"
        variant={submitVariant}
        disabled={disabled}
      >
        {submitLabel}
      </SubmitButton>
    </AppForm>
  );
}
