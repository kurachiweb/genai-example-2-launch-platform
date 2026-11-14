import { useMutation } from '@tanstack/react-query';

import { AppForm } from '../../../lib/components/form/app-form.tsx';
import { FormField } from '../../../lib/components/form/form-field.tsx';
import { FormMessage } from '../../../lib/components/form/form-message.tsx';
import { SubmitButton } from '../../../lib/components/form/submit-button.tsx';
import { useAppForm } from '../../../lib/components/form/use-app-form.ts';
import { Button } from '../../../lib/components/ui/button/button.tsx';
import { DialogFooter } from '../../../lib/components/ui/dialog/dialog-footer.tsx';
import { Input } from '../../../lib/components/ui/input/input.tsx';
import { graphqlMutationOptions } from '../../../lib/start/graphql/graphql-query-options.ts';
import {
  errorMessageOf,
  GraphQLClientError,
} from '../../../lib/utilities/graphql/graphql-result.ts';
import { CONFIRM_ACTION_CANCEL_LABEL } from '../../../lib/utilities/messages/admin-console-messages.ts';
import { ADMIN_PROFILE } from '../../composition/app-profile.ts';
import { AdminCompleteTotpResetDocument } from '../../graphql/generated/graphql.ts';
import {
  REQUIRED_SUFFIX,
  SECOND_FACTOR_FORM_LABEL,
  TOTP_CODE_DESCRIPTION,
  TOTP_CODE_LABEL,
} from '../auth/admin-auth-messages.ts';
import {
  TOTP_RESET_FORM_SCHEMA,
  type TotpResetFormInput,
} from './account-form-schemas.ts';
import { TOTP_RESET_SUBMIT_LABEL } from './account-messages.ts';
import { useSubmitFailure } from './use-submit-failure.ts';

export interface TotpResetFormProps {
  readonly pending: boolean;
  // 処理の間はダイアログが閉じる要求を受け付けない。失敗は投げ直してフォームの失敗の表示に任せる
  readonly run: (action: () => Promise<void>) => Promise<void>;
  // 処理中はダイアログが無視する
  readonly onCancel: () => void;
  readonly onCompleted: (recoveryCodes: readonly string[]) => void;
}

const DEFAULT_VALUES: TotpResetFormInput = Object.freeze({ totpCode: '' });

// 誤った認証コードの拒否は詳細を持たないため、入力した欄の誤りとして示す
const INVALID_SECOND_FACTOR_CODE = 'invalid_second_factor';

export function TotpResetForm({
  pending,
  run,
  onCancel,
  onCompleted,
}: TotpResetFormProps) {
  const form = useAppForm(TOTP_RESET_FORM_SCHEMA, {
    defaultValues: DEFAULT_VALUES,
  });
  // リカバリコードの平文を変更の結果の保管場所に残さないよう、結果を渡したら消し、保持もしない
  const complete = useMutation({
    ...graphqlMutationOptions(AdminCompleteTotpResetDocument),
    gcTime: 0,
  });
  const { failure, clearFailure, onSubmitError } = useSubmitFailure();

  return (
    <AppForm
      form={form}
      aria-label={SECOND_FACTOR_FORM_LABEL}
      onSubmit={({ totpCode }) =>
        run(async () => {
          clearFailure();
          const { completeAdminTotpReset } = await complete.mutateAsync({
            variables: { totpCode },
          });
          complete.reset();
          onCompleted(completeAdminTotpReset.codes);
        })
      }
      onSubmitError={(error) => {
        if (
          error instanceof GraphQLClientError &&
          error.code === INVALID_SECOND_FACTOR_CODE
        ) {
          form.setError(
            'totpCode',
            {
              type: 'server',
              message: errorMessageOf(error, ADMIN_PROFILE.contactAvailable),
            },
            { shouldFocus: true },
          );
          return;
        }
        onSubmitError(error);
      }}
      className="flex flex-col gap-5"
    >
      {failure === undefined ? null : (
        <FormMessage role="alert">{failure}</FormMessage>
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
        <Button
          type="button"
          variant="outline"
          aria-disabled={pending ? true : undefined}
          onClick={onCancel}
        >
          {CONFIRM_ACTION_CANCEL_LABEL}
        </Button>
        <SubmitButton>{TOTP_RESET_SUBMIT_LABEL}</SubmitButton>
      </DialogFooter>
    </AppForm>
  );
}
