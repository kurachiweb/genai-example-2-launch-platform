import { useMutation } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';

import { PasswordInput } from '../../../lib/components/auth/password-input.tsx';
import { TurnstileWidget } from '../../../lib/components/bot-protection/turnstile-widget.tsx';
import { useTurnstileToken } from '../../../lib/components/bot-protection/use-turnstile-token.ts';
import { AppForm } from '../../../lib/components/form/app-form.tsx';
import { FormField } from '../../../lib/components/form/form-field.tsx';
import { FormMessage } from '../../../lib/components/form/form-message.tsx';
import { SubmitButton } from '../../../lib/components/form/submit-button.tsx';
import { useAppForm } from '../../../lib/components/form/use-app-form.ts';
import { INLINE_LINK_CLASS_NAME } from '../../../lib/components/navigation/inline-link-class.ts';
import { Input } from '../../../lib/components/ui/input/input.tsx';
import { graphqlMutationOptions } from '../../../lib/start/graphql/graphql-query-options.ts';
import { sendWithTurnstile } from '../../../lib/utilities/bot-protection/send-with-turnstile.ts';
import { errorMessageOf } from '../../../lib/utilities/graphql/graphql-result.ts';
import { ADMIN_PROFILE } from '../../composition/app-profile.ts';
import { AdminLoginDocument } from '../../graphql/generated/graphql.ts';
import {
  EMAIL_LABEL,
  FORGOT_PASSWORD_PROMPT,
  LOGIN_PAGE_TITLE,
  LOGIN_SUBMIT_LABEL,
  PASSWORD_LABEL,
  PASSWORD_RESET_LABEL,
  PASSWORD_RESET_SUFFIX,
  REQUIRED_SUFFIX,
} from './admin-auth-messages.ts';
import { LOGIN_FORM_SCHEMA, type LoginFormInput } from './auth-form-schemas.ts';
import { ADMIN_BOT_ACTIONS } from './bot-actions.ts';
import { SecondFactorForm } from './second-factor-form.tsx';

export interface LoginFormProps {
  readonly returnTo: string;
}

const DEFAULT_VALUES: LoginFormInput = Object.freeze({
  email: '',
  password: '',
});

export function LoginForm({ returnTo }: LoginFormProps) {
  const form = useAppForm(LOGIN_FORM_SCHEMA, { defaultValues: DEFAULT_VALUES });
  const turnstile = useTurnstileToken();
  const login = useMutation(graphqlMutationOptions(AdminLoginDocument));
  const [submitError, setSubmitError] = useState<string>();
  const [challenge, setChallenge] = useState<string>();
  const [expiredCount, setExpiredCount] = useState(0);
  const { setFocus } = form;

  // 第2要素の段階から戻ると送信したボタンが描かれなくなっているため、入力し直すパスワードの欄へフォーカスを移す
  useEffect(() => {
    if (expiredCount > 0) {
      setFocus('password');
    }
  }, [expiredCount, setFocus]);

  if (challenge !== undefined) {
    return (
      <SecondFactorForm
        challenge={challenge}
        returnTo={returnTo}
        onExpired={(message) => {
          setChallenge(undefined);
          setSubmitError(message);
          setExpiredCount((count) => count + 1);
        }}
      />
    );
  }

  return (
    <>
      <AppForm
        form={form}
        aria-label={LOGIN_PAGE_TITLE}
        onSubmit={async ({ email, password }) => {
          setSubmitError(undefined);
          const { adminLogin } = await sendWithTurnstile(
            turnstile,
            (turnstileToken) =>
              login.mutateAsync({
                variables: { email, password },
                turnstileToken,
              }),
          );
          setChallenge(adminLogin.challenge);
        }}
        onSubmitError={(error) => {
          setSubmitError(errorMessageOf(error, ADMIN_PROFILE.contactAvailable));
        }}
        className="flex flex-col gap-5"
      >
        {submitError === undefined ? null : (
          <FormMessage role="alert">{submitError}</FormMessage>
        )}
        <FormField
          control={form.control}
          name="email"
          label={`${EMAIL_LABEL}${REQUIRED_SUFFIX}`}
        >
          {(control) => (
            <Input
              {...control}
              type="email"
              autoComplete="username"
              aria-required
            />
          )}
        </FormField>
        <FormField
          control={form.control}
          name="password"
          label={`${PASSWORD_LABEL}${REQUIRED_SUFFIX}`}
        >
          {(control) => (
            <PasswordInput
              {...control}
              autoComplete="current-password"
              aria-required
            />
          )}
        </FormField>
        <TurnstileWidget
          {...turnstile.widgetProps}
          action={ADMIN_BOT_ACTIONS.login}
        />
        <SubmitButton className="self-start">{LOGIN_SUBMIT_LABEL}</SubmitButton>
      </AppForm>
      <p className="text-sm">
        {FORGOT_PASSWORD_PROMPT}
        <Link to="/auth/password-reset" className={INLINE_LINK_CLASS_NAME}>
          {PASSWORD_RESET_LABEL}
        </Link>
        {PASSWORD_RESET_SUFFIX}
      </p>
    </>
  );
}
