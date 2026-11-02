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
import { Input } from '../../../lib/components/ui/input/input.tsx';
import { graphqlMutationOptions } from '../../../lib/start/graphql/graphql-query-options.ts';
import { errorMessageOf } from '../../../lib/utilities/graphql/graphql-result.ts';
import { CLIENT_PROFILE } from '../../composition/app-profile.ts';
import { ClientLoginDocument } from '../../graphql/generated/graphql.ts';
import { PathLink } from '../navigation/path-link.tsx';
import {
  LOGIN_FORM_SCHEMA,
  type LoginFormInput,
} from './account-form-schemas.ts';
import {
  EMAIL_LABEL,
  FORGOT_PASSWORD_PROMPT,
  LINK_ACTION_SUFFIX,
  LOGIN_PAGE_TITLE,
  LOGIN_SUBMIT_LABEL,
  NO_ACCOUNT_PROMPT,
  PASSWORD_LABEL,
  PASSWORD_RESET_LABEL,
  PASSWORD_RESET_SUFFIX,
  REGISTER_LABEL,
} from './account-messages.ts';
import { BOT_ACTIONS } from './bot-actions.ts';
import { INLINE_LINK_CLASS_NAME } from './inline-link-class.ts';
import { SecondFactorForm } from './second-factor-form.tsx';
import { useSignedInNavigation } from './use-signed-in-navigation.ts';

export interface LoginFormProps {
  readonly returnTo: string;
}

const DEFAULT_VALUES: LoginFormInput = Object.freeze({
  email: '',
  password: '',
});

const PASSWORD_RESET_PATH = '/auth/password-reset';

export function LoginForm({ returnTo }: LoginFormProps) {
  const form = useAppForm(LOGIN_FORM_SCHEMA, { defaultValues: DEFAULT_VALUES });
  const turnstile = useTurnstileToken();
  const login = useMutation(graphqlMutationOptions(ClientLoginDocument));
  const enterSignedIn = useSignedInNavigation();
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
        serverFieldPrefix="input"
        onSubmit={async (input) => {
          setSubmitError(undefined);
          const { login: result } = await login.mutateAsync({
            variables: { input },
            turnstileToken: turnstile.consume(),
          });
          if (result.__typename === 'SecondFactorRequired') {
            setChallenge(result.challenge);
            return;
          }
          await enterSignedIn(returnTo);
        }}
        onSubmitError={(error) => {
          setSubmitError(
            errorMessageOf(error, CLIENT_PROFILE.contactAvailable),
          );
        }}
        className="flex flex-col gap-5"
      >
        {submitError === undefined ? null : (
          <FormMessage role="alert">{submitError}</FormMessage>
        )}
        <FormField control={form.control} name="email" label={EMAIL_LABEL}>
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
          label={PASSWORD_LABEL}
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
          action={BOT_ACTIONS.login}
        />
        <SubmitButton className="self-start">{LOGIN_SUBMIT_LABEL}</SubmitButton>
      </AppForm>
      <div className="flex flex-col gap-2 text-sm">
        <p>
          {NO_ACCOUNT_PROMPT}
          <Link to="/auth/register" className={INLINE_LINK_CLASS_NAME}>
            {REGISTER_LABEL}
          </Link>
          {LINK_ACTION_SUFFIX}
        </p>
        <p>
          {FORGOT_PASSWORD_PROMPT}
          <PathLink
            href={PASSWORD_RESET_PATH}
            className={INLINE_LINK_CLASS_NAME}
          >
            {PASSWORD_RESET_LABEL}
          </PathLink>
          {PASSWORD_RESET_SUFFIX}
        </p>
      </div>
    </>
  );
}
