import { useMutation } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';

import { TurnstileWidget } from '../../../lib/components/bot-protection/turnstile-widget.tsx';
import { useTurnstileToken } from '../../../lib/components/bot-protection/use-turnstile-token.ts';
import { AppForm } from '../../../lib/components/form/app-form.tsx';
import { FormField } from '../../../lib/components/form/form-field.tsx';
import { FormMessage } from '../../../lib/components/form/form-message.tsx';
import { SubmitButton } from '../../../lib/components/form/submit-button.tsx';
import { useAppForm } from '../../../lib/components/form/use-app-form.ts';
import { Input } from '../../../lib/components/ui/input/input.tsx';
import { graphqlMutationOptions } from '../../../lib/start/graphql/graphql-query-options.ts';
import { errorMessageOf } from '../../../lib/utilities/graphql/graphql-result.ts';
import { CLIENT_PROFILE } from '../../composition/app-profile.ts';
import { ClientRequestPasswordResetDocument } from '../../graphql/generated/graphql.ts';
import {
  PASSWORD_RESET_REQUEST_FORM_SCHEMA,
  type PasswordResetRequestFormInput,
} from './account-form-schemas.ts';
import {
  EMAIL_LABEL,
  LOGIN_PAGE_LINK_LABEL,
  PASSWORD_RESET_LINK_SENT_MESSAGE,
  PASSWORD_RESET_PAGE_TITLE,
  PASSWORD_RESET_REQUEST_DESCRIPTION,
  PASSWORD_RESET_REQUEST_SUBMIT_LABEL,
  REQUIRED_SUFFIX,
} from './account-messages.ts';
import { BOT_ACTIONS } from './bot-actions.ts';
import { INLINE_LINK_CLASS_NAME } from './inline-link-class.ts';
import { ResultNotice } from './result-notice.tsx';

const DEFAULT_VALUES: PasswordResetRequestFormInput = Object.freeze({
  email: '',
});

export function PasswordResetRequestForm() {
  const form = useAppForm(PASSWORD_RESET_REQUEST_FORM_SCHEMA, {
    defaultValues: DEFAULT_VALUES,
  });
  const turnstile = useTurnstileToken();
  const requestReset = useMutation(
    graphqlMutationOptions(ClientRequestPasswordResetDocument),
  );
  const [submitError, setSubmitError] = useState<string>();
  const [sent, setSent] = useState(false);

  // アカウントの有無で応答が変わらないため、送信できた後はどのメールアドレスでも同じ案内を示す
  if (sent) {
    return (
      <ResultNotice tone="success" message={PASSWORD_RESET_LINK_SENT_MESSAGE}>
        <Link to="/auth/login" className={INLINE_LINK_CLASS_NAME}>
          {LOGIN_PAGE_LINK_LABEL}
        </Link>
      </ResultNotice>
    );
  }

  return (
    <AppForm
      form={form}
      aria-label={PASSWORD_RESET_PAGE_TITLE}
      onSubmit={async ({ email }) => {
        setSubmitError(undefined);
        await requestReset.mutateAsync({
          variables: { email },
          turnstileToken: turnstile.consume(),
        });
        setSent(true);
      }}
      onSubmitError={(error) => {
        setSubmitError(errorMessageOf(error, CLIENT_PROFILE.contactAvailable));
      }}
      className="flex flex-col gap-5"
    >
      {submitError === undefined ? null : (
        <FormMessage role="alert">{submitError}</FormMessage>
      )}
      <p className="text-sm text-muted-foreground">
        {PASSWORD_RESET_REQUEST_DESCRIPTION}
      </p>
      <FormField
        control={form.control}
        name="email"
        label={`${EMAIL_LABEL}${REQUIRED_SUFFIX}`}
      >
        {(control) => (
          <Input {...control} type="email" autoComplete="email" aria-required />
        )}
      </FormField>
      <TurnstileWidget
        {...turnstile.widgetProps}
        action={BOT_ACTIONS.passwordReset}
      />
      <SubmitButton className="self-start">
        {PASSWORD_RESET_REQUEST_SUBMIT_LABEL}
      </SubmitButton>
    </AppForm>
  );
}
