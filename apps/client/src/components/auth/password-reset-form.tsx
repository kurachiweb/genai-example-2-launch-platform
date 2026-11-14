import { useMutation } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';

import { PasswordInput } from '../../../lib/components/auth/password-input.tsx';
import { AppForm } from '../../../lib/components/form/app-form.tsx';
import { FormField } from '../../../lib/components/form/form-field.tsx';
import { FormMessage } from '../../../lib/components/form/form-message.tsx';
import { SubmitButton } from '../../../lib/components/form/submit-button.tsx';
import { useAppForm } from '../../../lib/components/form/use-app-form.ts';
import { graphqlMutationOptions } from '../../../lib/start/graphql/graphql-query-options.ts';
import { errorMessageOf } from '../../../lib/utilities/graphql/graphql-result.ts';
import { CLIENT_PROFILE } from '../../composition/app-profile.ts';
import { ClientResetPasswordDocument } from '../../graphql/generated/graphql.ts';
import {
  PASSWORD_RESET_FORM_SCHEMA,
  type PasswordResetFormInput,
} from './account-form-schemas.ts';
import {
  INVALID_LINK_MESSAGE,
  LOGIN_PAGE_LINK_LABEL,
  NEW_PASSWORD_DESCRIPTION,
  NEW_PASSWORD_LABEL,
  PASSWORD_RESET_CONFIRM_PAGE_TITLE,
  PASSWORD_RESET_DONE_MESSAGE,
  PASSWORD_RESET_LABEL,
  PASSWORD_RESET_SUBMIT_LABEL,
  REQUIRED_SUFFIX,
  RETRY_PASSWORD_RESET_SUFFIX,
} from './account-messages.ts';
import { INLINE_LINK_CLASS_NAME } from '../../../lib/components/navigation/inline-link-class.ts';
import { isInvalidLinkError } from '../../../lib/utilities/auth/invalid-link.ts';
import { ResultNotice } from '../../../lib/components/feedback/result-notice.tsx';
import { useFragmentToken } from '../../../lib/components/auth/use-fragment-token.ts';
import { useViewerRefresh } from './use-viewer-refresh.ts';

const DEFAULT_VALUES: PasswordResetFormInput = Object.freeze({
  newPassword: '',
});

type ResetState = 'editing' | 'done' | 'invalid';

export function PasswordResetForm() {
  const link = useFragmentToken();
  const form = useAppForm(PASSWORD_RESET_FORM_SCHEMA, {
    defaultValues: DEFAULT_VALUES,
  });
  const resetPassword = useMutation(
    graphqlMutationOptions(ClientResetPasswordDocument),
  );
  const refreshViewer = useViewerRefresh();
  const [state, setState] = useState<ResetState>('editing');
  const [submitError, setSubmitError] = useState<string>();

  if (link.status === 'reading') {
    return null;
  }

  if (link.status === 'missing' || state === 'invalid') {
    return (
      <ResultNotice tone="error" message={INVALID_LINK_MESSAGE}>
        <p>
          <Link to="/auth/password-reset" className={INLINE_LINK_CLASS_NAME}>
            {PASSWORD_RESET_LABEL}
          </Link>
          {RETRY_PASSWORD_RESET_SUFFIX}
        </p>
      </ResultNotice>
    );
  }

  if (state === 'done') {
    return (
      <ResultNotice tone="success" message={PASSWORD_RESET_DONE_MESSAGE}>
        <Link to="/auth/login" className={INLINE_LINK_CLASS_NAME}>
          {LOGIN_PAGE_LINK_LABEL}
        </Link>
      </ResultNotice>
    );
  }

  return (
    <AppForm
      form={form}
      aria-label={PASSWORD_RESET_CONFIRM_PAGE_TITLE}
      serverFieldPrefix="input"
      onSubmit={async ({ newPassword }) => {
        setSubmitError(undefined);
        await resetPassword.mutateAsync({
          variables: { input: { token: link.token, newPassword } },
        });
        await refreshViewer();
        setState('done');
      }}
      onSubmitError={(error) => {
        if (isInvalidLinkError(error)) {
          setState('invalid');
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
        name="newPassword"
        label={`${NEW_PASSWORD_LABEL}${REQUIRED_SUFFIX}`}
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
        {PASSWORD_RESET_SUBMIT_LABEL}
      </SubmitButton>
    </AppForm>
  );
}
