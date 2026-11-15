import { useMutation } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { PasswordInput } from '../../../lib/components/auth/password-input.tsx';
import { ResultNotice } from '../../../lib/components/feedback/result-notice.tsx';
import { AppForm } from '../../../lib/components/form/app-form.tsx';
import { FormField } from '../../../lib/components/form/form-field.tsx';
import { FormMessage } from '../../../lib/components/form/form-message.tsx';
import { SubmitButton } from '../../../lib/components/form/submit-button.tsx';
import { useAppForm } from '../../../lib/components/form/use-app-form.ts';
import { graphqlMutationOptions } from '../../../lib/start/graphql/graphql-query-options.ts';
import { AdminChangePasswordDocument } from '../../graphql/generated/graphql.ts';
import {
  NEW_PASSWORD_DESCRIPTION,
  NEW_PASSWORD_LABEL,
  REQUIRED_SUFFIX,
} from '../auth/admin-auth-messages.ts';
import {
  PASSWORD_CHANGE_FORM_SCHEMAS,
  type PasswordChangeFormInput,
  REAUTHENTICATION_DEFAULT_VALUES,
  REAUTHENTICATION_FIELD_NAMES,
} from './account-form-schemas.ts';
import {
  PASSWORD_CHANGE_SECTION_DESCRIPTION,
  PASSWORD_CHANGE_SECTION_TITLE,
  PASSWORD_CHANGE_SUBMIT_LABEL,
  PASSWORD_CHANGED_MESSAGE,
} from './account-messages.ts';
import { AccountSection } from './account-section.tsx';
import { ReauthenticationFields } from './reauthentication-fields.tsx';
import { useReauthenticationMode } from './use-reauthentication-mode.ts';
import { useReauthenticatedSend } from './use-reauthenticated-send.ts';
import { useSubmitFailure } from './use-submit-failure.ts';

const DEFAULT_VALUES: PasswordChangeFormInput = Object.freeze({
  newPassword: '',
  reAuthentication: REAUTHENTICATION_DEFAULT_VALUES,
});

export function PasswordChangeSection() {
  const { mode, toggleSecondFactor } = useReauthenticationMode();
  const form = useAppForm(PASSWORD_CHANGE_FORM_SCHEMAS[mode], {
    defaultValues: DEFAULT_VALUES,
  });
  const changePassword = useMutation(
    graphqlMutationOptions(AdminChangePasswordDocument),
  );
  const send = useReauthenticatedSend();
  const { failure, clearFailure, onSubmitError } = useSubmitFailure();
  const [changedCount, setChangedCount] = useState(0);
  const { reset } = form;

  // 送信の処理の中で値を戻すと送信の完了の状態の更新と重なるため、送信できた後に戻す
  useEffect(() => {
    if (changedCount > 0) {
      reset(DEFAULT_VALUES);
    }
  }, [changedCount, reset]);

  return (
    <AccountSection
      title={PASSWORD_CHANGE_SECTION_TITLE}
      description={PASSWORD_CHANGE_SECTION_DESCRIPTION}
    >
      {changedCount === 0 ? null : (
        <ResultNotice
          key={changedCount}
          tone="success"
          message={PASSWORD_CHANGED_MESSAGE}
        />
      )}
      <AppForm
        form={form}
        aria-label={PASSWORD_CHANGE_SECTION_TITLE}
        onSubmit={async (variables) => {
          clearFailure();
          // 変更は全端末のセッションを消してこの端末へ発行し直すため、成功の後はログイン中の管理者を取り直させる
          await send(
            variables.reAuthentication,
            () => changePassword.mutateAsync({ variables }),
            { refreshOnSuccess: true },
          );
          setChangedCount((count) => count + 1);
        }}
        onSubmitError={onSubmitError}
        className="flex flex-col gap-5"
      >
        {failure === undefined ? null : (
          <FormMessage role="alert">{failure}</FormMessage>
        )}
        <FormField
          control={form.control}
          name="newPassword"
          label={`${NEW_PASSWORD_LABEL}${REQUIRED_SUFFIX}`}
          description={NEW_PASSWORD_DESCRIPTION}
        >
          {(field) => (
            <PasswordInput
              {...field}
              autoComplete="new-password"
              aria-required
            />
          )}
        </FormField>
        <ReauthenticationFields
          control={form.control}
          names={REAUTHENTICATION_FIELD_NAMES}
          mode={mode}
          onToggleSecondFactor={toggleSecondFactor}
        />
        <SubmitButton className="self-start">
          {PASSWORD_CHANGE_SUBMIT_LABEL}
        </SubmitButton>
      </AppForm>
    </AccountSection>
  );
}
