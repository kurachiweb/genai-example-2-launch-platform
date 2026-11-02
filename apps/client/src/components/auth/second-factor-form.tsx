import { useMutation } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { AppForm } from '../../../lib/components/form/app-form.tsx';
import { FormField } from '../../../lib/components/form/form-field.tsx';
import { FormMessage } from '../../../lib/components/form/form-message.tsx';
import { SubmitButton } from '../../../lib/components/form/submit-button.tsx';
import { useAppForm } from '../../../lib/components/form/use-app-form.ts';
import { Button } from '../../../lib/components/ui/button/button.tsx';
import { Input } from '../../../lib/components/ui/input/input.tsx';
import { graphqlMutationOptions } from '../../../lib/start/graphql/graphql-query-options.ts';
import {
  errorMessageOf,
  GraphQLClientError,
} from '../../../lib/utilities/graphql/graphql-result.ts';
import { CLIENT_PROFILE } from '../../composition/app-profile.ts';
import { ClientCompleteSecondFactorLoginDocument } from '../../graphql/generated/graphql.ts';
import {
  RECOVERY_CODE_FORM_SCHEMA,
  type SecondFactorFormInput,
  type SecondFactorFormSchema,
  TOTP_CODE_FORM_SCHEMA,
} from './account-form-schemas.ts';
import {
  LOGIN_SUBMIT_LABEL,
  RECOVERY_CODE_DESCRIPTION,
  RECOVERY_CODE_LABEL,
  SECOND_FACTOR_FORM_LABEL,
  TOTP_CODE_DESCRIPTION,
  TOTP_CODE_LABEL,
  USE_RECOVERY_CODE_LABEL,
  USE_TOTP_CODE_LABEL,
} from './account-messages.ts';
import { useSignedInNavigation } from './use-signed-in-navigation.ts';

export interface SecondFactorFormProps {
  readonly challenge: string;
  readonly returnTo: string;
  readonly onExpired: (message: string) => void;
}

type SecondFactorMode = 'totp' | 'recovery';

const SCHEMAS: Readonly<Record<SecondFactorMode, SecondFactorFormSchema>> =
  Object.freeze({
    totp: TOTP_CODE_FORM_SCHEMA,
    recovery: RECOVERY_CODE_FORM_SCHEMA,
  });

const FIELD_NAMES = Object.freeze({
  totp: 'secondFactor.totpCode',
  recovery: 'secondFactor.recoveryCode',
} as const);

const DEFAULT_VALUES: SecondFactorFormInput = Object.freeze({
  secondFactor: { totpCode: '', recoveryCode: '' },
});

const LOGIN_CHALLENGE_EXPIRED_CODE = 'login_challenge_expired';

export function SecondFactorForm({
  challenge,
  returnTo,
  onExpired,
}: SecondFactorFormProps) {
  const [mode, setMode] = useState<SecondFactorMode>('totp');
  const form = useAppForm(SCHEMAS[mode], { defaultValues: DEFAULT_VALUES });
  const completeLogin = useMutation(
    graphqlMutationOptions(ClientCompleteSecondFactorLoginDocument),
  );
  const enterSignedIn = useSignedInNavigation();
  const [submitError, setSubmitError] = useState<string>();
  const { setFocus } = form;

  // 送信したパスワードの欄と、切り替えの前の欄は描かれなくなるため、描いた入力欄へフォーカスを移す
  useEffect(() => {
    setFocus(FIELD_NAMES[mode]);
  }, [mode, setFocus]);

  return (
    <AppForm
      form={form}
      aria-label={SECOND_FACTOR_FORM_LABEL}
      serverFieldPrefix="input"
      onSubmit={async ({ secondFactor }) => {
        setSubmitError(undefined);
        await completeLogin.mutateAsync({
          variables: { input: { challenge, secondFactor } },
        });
        await enterSignedIn(returnTo);
      }}
      onSubmitError={(error) => {
        if (
          error instanceof GraphQLClientError &&
          error.code === LOGIN_CHALLENGE_EXPIRED_CODE
        ) {
          onExpired(error.message);
          return;
        }
        setSubmitError(errorMessageOf(error, CLIENT_PROFILE.contactAvailable));
      }}
      className="flex flex-col gap-5"
    >
      {submitError === undefined ? null : (
        <FormMessage role="alert">{submitError}</FormMessage>
      )}
      {mode === 'totp' ? (
        <FormField
          key={mode}
          control={form.control}
          name={FIELD_NAMES.totp}
          label={TOTP_CODE_LABEL}
          description={TOTP_CODE_DESCRIPTION}
        >
          {(control) => (
            <Input
              {...control}
              autoComplete="one-time-code"
              inputMode="numeric"
              aria-required
            />
          )}
        </FormField>
      ) : (
        <FormField
          key={mode}
          control={form.control}
          name={FIELD_NAMES.recovery}
          label={RECOVERY_CODE_LABEL}
          description={RECOVERY_CODE_DESCRIPTION}
        >
          {(control) => (
            <Input
              {...control}
              autoComplete="off"
              translate="no"
              aria-required
            />
          )}
        </FormField>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton>{LOGIN_SUBMIT_LABEL}</SubmitButton>
        <Button
          type="button"
          variant="link"
          // 押した時に入力欄からフォーカスが外れると、未入力のエラーが切り替えのボタンの上に出てボタンが押している間に動き、押した操作が失われるため、押下ではフォーカスを移さない
          onMouseDown={(event) => {
            event.preventDefault();
          }}
          onClick={() => {
            setMode((current) => (current === 'totp' ? 'recovery' : 'totp'));
          }}
        >
          {mode === 'totp' ? USE_RECOVERY_CODE_LABEL : USE_TOTP_CODE_LABEL}
        </Button>
      </div>
    </AppForm>
  );
}
