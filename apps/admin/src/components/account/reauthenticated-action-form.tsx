import { useEffect, useState } from 'react';

import { AppForm } from '../../../lib/components/form/app-form.tsx';
import { FormMessage } from '../../../lib/components/form/form-message.tsx';
import { SubmitButton } from '../../../lib/components/form/submit-button.tsx';
import { useAppForm } from '../../../lib/components/form/use-app-form.ts';
import {
  REAUTHENTICATION_DEFAULT_VALUES,
  REAUTHENTICATION_FIELD_NAMES,
  REAUTHENTICATION_FORM_SCHEMAS,
  type ReauthenticationFormInput,
  type ReauthenticationValues,
} from './account-form-schemas.ts';
import { ReauthenticationFields } from './reauthentication-fields.tsx';
import { useReauthenticationMode } from './use-reauthentication-mode.ts';
import { useReauthenticatedSend } from './use-reauthenticated-send.ts';
import { useSubmitFailure } from './use-submit-failure.ts';

export interface ReauthenticatedActionFormProps {
  readonly label: string;
  readonly submitLabel: string;
  // 成功がセッションを入れ替えるなど、本人確認の入力によらず成功の後にログイン中の管理者を取り直す操作か
  readonly refreshOnSuccess: boolean;
  readonly onSubmit: (input: {
    readonly reAuthentication: ReauthenticationValues;
  }) => Promise<void>;
}

const DEFAULT_VALUES: ReauthenticationFormInput = Object.freeze({
  reAuthentication: REAUTHENTICATION_DEFAULT_VALUES,
});

// 本人確認だけを入力に取る操作のフォーム。成功の後の表示は呼び出し側が受け持つ
export function ReauthenticatedActionForm({
  label,
  submitLabel,
  refreshOnSuccess,
  onSubmit,
}: ReauthenticatedActionFormProps) {
  const { mode, toggleSecondFactor } = useReauthenticationMode();
  const form = useAppForm(REAUTHENTICATION_FORM_SCHEMAS[mode], {
    defaultValues: DEFAULT_VALUES,
  });
  const send = useReauthenticatedSend();
  const { failure, clearFailure, onSubmitError } = useSubmitFailure();
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
      onSubmit={async (input) => {
        clearFailure();
        await send(input.reAuthentication, () => onSubmit(input), {
          refreshOnSuccess,
        });
        setSentCount((count) => count + 1);
      }}
      onSubmitError={onSubmitError}
      className="flex flex-col gap-5"
    >
      {failure === undefined ? null : (
        <FormMessage role="alert">{failure}</FormMessage>
      )}
      <ReauthenticationFields
        control={form.control}
        names={REAUTHENTICATION_FIELD_NAMES}
        mode={mode}
        onToggleSecondFactor={toggleSecondFactor}
      />
      <SubmitButton className="self-start">{submitLabel}</SubmitButton>
    </AppForm>
  );
}
