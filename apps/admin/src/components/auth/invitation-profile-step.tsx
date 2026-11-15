import { useMutation } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { PasswordInput } from '../../../lib/components/auth/password-input.tsx';
import { AppForm } from '../../../lib/components/form/app-form.tsx';
import { FormField } from '../../../lib/components/form/form-field.tsx';
import { FormMessage } from '../../../lib/components/form/form-message.tsx';
import { SubmitButton } from '../../../lib/components/form/submit-button.tsx';
import { useAppForm } from '../../../lib/components/form/use-app-form.ts';
import { Input } from '../../../lib/components/ui/input/input.tsx';
import { graphqlMutationOptions } from '../../../lib/start/graphql/graphql-query-options.ts';
import { isInvalidLinkError } from '../../../lib/utilities/auth/invalid-link.ts';
import { errorMessageOf } from '../../../lib/utilities/graphql/graphql-result.ts';
import { ADMIN_PROFILE } from '../../composition/app-profile.ts';
import {
  AdminStartInvitationDocument,
  type AdminStartInvitationMutation,
} from '../../graphql/generated/graphql.ts';
import {
  INVITATION_PROFILE_DESCRIPTION,
  INVITATION_PROFILE_FORM_LABEL,
  INVITATION_PROFILE_SUBMIT_LABEL,
  NEW_PASSWORD_DESCRIPTION,
  NICKNAME_DESCRIPTION,
  NICKNAME_LABEL,
  PASSWORD_LABEL,
  REQUIRED_SUFFIX,
} from './admin-auth-messages.ts';
import {
  INVITATION_PROFILE_FORM_SCHEMA,
  type InvitationProfileFormInput,
} from './auth-form-schemas.ts';

export type InvitationTotpSetup =
  AdminStartInvitationMutation['startAdminInvitation'];

export interface InvitationProfileStepProps {
  readonly token: string;
  // 認証コードの段階から戻した理由。示す時は入力し直すニックネームの欄へフォーカスを移す
  readonly restartReason?: string;
  readonly onStarted: (setup: InvitationTotpSetup) => void;
  readonly onInvalidLink: () => void;
}

const DEFAULT_VALUES: InvitationProfileFormInput = Object.freeze({
  nickname: '',
  password: '',
});

export function InvitationProfileStep({
  token,
  restartReason,
  onStarted,
  onInvalidLink,
}: InvitationProfileStepProps) {
  const form = useAppForm(INVITATION_PROFILE_FORM_SCHEMA, {
    defaultValues: DEFAULT_VALUES,
  });
  // 秘密鍵の平文を変更の結果の保管場所に残さないよう、結果を渡したら消し、保持もしない
  const start = useMutation({
    ...graphqlMutationOptions(AdminStartInvitationDocument),
    gcTime: 0,
  });
  const [submitError, setSubmitError] = useState(restartReason);
  const { setFocus } = form;

  // 認証コードの段階から戻ると送信したボタンが描かれなくなっているため、最初の入力欄へフォーカスを移す
  useEffect(() => {
    if (restartReason !== undefined) {
      setFocus('nickname');
    }
  }, [restartReason, setFocus]);

  return (
    <AppForm
      form={form}
      aria-label={INVITATION_PROFILE_FORM_LABEL}
      onSubmit={async ({ nickname, password }) => {
        setSubmitError(undefined);
        const { startAdminInvitation } = await start.mutateAsync({
          variables: { token, nickname, password },
        });
        start.reset();
        onStarted(startAdminInvitation);
      }}
      onSubmitError={(error) => {
        if (isInvalidLinkError(error)) {
          onInvalidLink();
          return;
        }
        setSubmitError(errorMessageOf(error, ADMIN_PROFILE.contactAvailable));
      }}
      className="flex flex-col gap-5"
    >
      {submitError === undefined ? null : (
        <FormMessage role="alert">{submitError}</FormMessage>
      )}
      <p className="text-sm text-muted-foreground">
        {INVITATION_PROFILE_DESCRIPTION}
      </p>
      <FormField
        control={form.control}
        name="nickname"
        label={`${NICKNAME_LABEL}${REQUIRED_SUFFIX}`}
        description={NICKNAME_DESCRIPTION}
      >
        {(control) => (
          <Input {...control} autoComplete="nickname" aria-required />
        )}
      </FormField>
      <FormField
        control={form.control}
        name="password"
        label={`${PASSWORD_LABEL}${REQUIRED_SUFFIX}`}
        description={NEW_PASSWORD_DESCRIPTION}
      >
        {(control) => (
          <PasswordInput
            {...control}
            autoComplete="new-password"
            aria-required
          />
        )}
      </FormField>
      <SubmitButton className="self-start">
        {INVITATION_PROFILE_SUBMIT_LABEL}
      </SubmitButton>
    </AppForm>
  );
}
