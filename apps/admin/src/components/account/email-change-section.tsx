import { useMutation } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { ResultNotice } from '../../../lib/components/feedback/result-notice.tsx';
import { AppForm } from '../../../lib/components/form/app-form.tsx';
import { FormField } from '../../../lib/components/form/form-field.tsx';
import { FormMessage } from '../../../lib/components/form/form-message.tsx';
import { SubmitButton } from '../../../lib/components/form/submit-button.tsx';
import { useAppForm } from '../../../lib/components/form/use-app-form.ts';
import { Input } from '../../../lib/components/ui/input/input.tsx';
import { graphqlMutationOptions } from '../../../lib/start/graphql/graphql-query-options.ts';
import { AdminRequestEmailChangeDocument } from '../../graphql/generated/graphql.ts';
import { REQUIRED_SUFFIX } from '../auth/admin-auth-messages.ts';
import {
  EMAIL_CHANGE_FORM_SCHEMAS,
  type EmailChangeFormInput,
  REAUTHENTICATION_DEFAULT_VALUES,
  REAUTHENTICATION_FIELD_NAMES,
} from './account-form-schemas.ts';
import {
  currentEmailText,
  EMAIL_CHANGE_REQUESTED_MESSAGE,
  EMAIL_CHANGE_SECTION_DESCRIPTION,
  EMAIL_CHANGE_SECTION_TITLE,
  EMAIL_CHANGE_SUBMIT_LABEL,
  NEW_EMAIL_LABEL,
} from './account-messages.ts';
import { AccountSection } from './account-section.tsx';
import { ReauthenticationFields } from './reauthentication-fields.tsx';
import { useReauthenticationMode } from './use-reauthentication-mode.ts';
import { useReauthenticatedSend } from './use-reauthenticated-send.ts';
import { useSubmitFailure } from './use-submit-failure.ts';

export interface EmailChangeSectionProps {
  readonly currentEmail: string;
}

const DEFAULT_VALUES: EmailChangeFormInput = Object.freeze({
  newEmail: '',
  reAuthentication: REAUTHENTICATION_DEFAULT_VALUES,
});

export function EmailChangeSection({ currentEmail }: EmailChangeSectionProps) {
  const { mode, toggleSecondFactor } = useReauthenticationMode();
  const form = useAppForm(EMAIL_CHANGE_FORM_SCHEMAS[mode], {
    defaultValues: DEFAULT_VALUES,
  });
  const requestChange = useMutation(
    graphqlMutationOptions(AdminRequestEmailChangeDocument),
  );
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
    <AccountSection
      title={EMAIL_CHANGE_SECTION_TITLE}
      description={EMAIL_CHANGE_SECTION_DESCRIPTION}
    >
      <p className="text-sm break-all">{currentEmailText(currentEmail)}</p>
      {sentCount === 0 ? null : (
        <ResultNotice
          key={sentCount}
          tone="success"
          message={EMAIL_CHANGE_REQUESTED_MESSAGE}
        />
      )}
      <AppForm
        form={form}
        aria-label={EMAIL_CHANGE_SECTION_TITLE}
        onSubmit={async (variables) => {
          clearFailure();
          await send(
            variables.reAuthentication,
            () => requestChange.mutateAsync({ variables }),
            { refreshOnSuccess: false },
          );
          setSentCount((count) => count + 1);
        }}
        onSubmitError={onSubmitError}
        className="flex flex-col gap-5"
      >
        {failure === undefined ? null : (
          <FormMessage role="alert">{failure}</FormMessage>
        )}
        <FormField
          control={form.control}
          name="newEmail"
          label={`${NEW_EMAIL_LABEL}${REQUIRED_SUFFIX}`}
        >
          {(field) => (
            <Input {...field} type="email" autoComplete="email" aria-required />
          )}
        </FormField>
        <ReauthenticationFields
          control={form.control}
          names={REAUTHENTICATION_FIELD_NAMES}
          mode={mode}
          onToggleSecondFactor={toggleSecondFactor}
        />
        <SubmitButton className="self-start">
          {EMAIL_CHANGE_SUBMIT_LABEL}
        </SubmitButton>
      </AppForm>
    </AccountSection>
  );
}
