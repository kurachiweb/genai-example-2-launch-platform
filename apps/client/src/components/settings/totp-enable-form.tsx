import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';

import { AppForm } from '../../../lib/components/form/app-form.tsx';
import { FormField } from '../../../lib/components/form/form-field.tsx';
import { FormMessage } from '../../../lib/components/form/form-message.tsx';
import { SubmitButton } from '../../../lib/components/form/submit-button.tsx';
import { useAppForm } from '../../../lib/components/form/use-app-form.ts';
import { Button } from '../../../lib/components/ui/button/button.tsx';
import { DialogClose } from '../../../lib/components/ui/dialog/dialog-close.tsx';
import { DialogFooter } from '../../../lib/components/ui/dialog/dialog-footer.tsx';
import { Input } from '../../../lib/components/ui/input/input.tsx';
import { graphqlMutationOptions } from '../../../lib/start/graphql/graphql-query-options.ts';
import {
  errorMessageOf,
  GraphQLClientError,
} from '../../../lib/utilities/graphql/graphql-result.ts';
import { CLIENT_PROFILE } from '../../composition/app-profile.ts';
import { ClientEnableTotpDocument } from '../../graphql/generated/graphql.ts';
import {
  TOTP_ENABLE_FORM_SCHEMA,
  type TotpEnableFormInput,
} from '../auth/account-form-schemas.ts';
import {
  REQUIRED_SUFFIX,
  SECOND_FACTOR_FORM_LABEL,
  TOTP_CODE_DESCRIPTION,
  TOTP_CODE_LABEL,
} from '../auth/account-messages.ts';
import { CANCEL_LABEL, TOTP_ENABLE_SUBMIT_LABEL } from './settings-messages.ts';

export interface TotpEnableFormProps {
  readonly onEnabled: (recoveryCodes: readonly string[]) => void;
}

const DEFAULT_VALUES: TotpEnableFormInput = Object.freeze({ totpCode: '' });

// 誤った認証コードの拒否は詳細を持たないため、入力した欄の誤りとして示す
const INVALID_SECOND_FACTOR_CODE = 'invalid_second_factor';

export function TotpEnableForm({ onEnabled }: TotpEnableFormProps) {
  const form = useAppForm(TOTP_ENABLE_FORM_SCHEMA, {
    defaultValues: DEFAULT_VALUES,
  });
  // リカバリコードの平文を変更の結果の保管場所に残さないよう、結果を渡したら消し、保持もしない
  const enable = useMutation({
    ...graphqlMutationOptions(ClientEnableTotpDocument),
    gcTime: 0,
  });
  const [submitError, setSubmitError] = useState<string>();

  return (
    <AppForm
      form={form}
      aria-label={SECOND_FACTOR_FORM_LABEL}
      onSubmit={async ({ totpCode }) => {
        setSubmitError(undefined);
        const { enableTotp } = await enable.mutateAsync({
          variables: { totpCode },
        });
        onEnabled(enableTotp.codes);
        enable.reset();
      }}
      onSubmitError={(error) => {
        if (
          error instanceof GraphQLClientError &&
          error.code === INVALID_SECOND_FACTOR_CODE
        ) {
          form.setError(
            'totpCode',
            {
              type: 'server',
              message: errorMessageOf(error, CLIENT_PROFILE.contactAvailable),
            },
            { shouldFocus: true },
          );
          return;
        }
        setSubmitError(errorMessageOf(error, CLIENT_PROFILE.contactAvailable));
      }}
      className="flex flex-col gap-5"
    >
      {submitError === undefined ? null : (
        <FormMessage role="alert">{submitError}</FormMessage>
      )}
      <FormField
        control={form.control}
        name="totpCode"
        label={`${TOTP_CODE_LABEL}${REQUIRED_SUFFIX}`}
        description={TOTP_CODE_DESCRIPTION}
      >
        {(field) => (
          <Input
            {...field}
            autoComplete="one-time-code"
            inputMode="numeric"
            aria-required
          />
        )}
      </FormField>
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline">
            {CANCEL_LABEL}
          </Button>
        </DialogClose>
        <SubmitButton>{TOTP_ENABLE_SUBMIT_LABEL}</SubmitButton>
      </DialogFooter>
    </AppForm>
  );
}
