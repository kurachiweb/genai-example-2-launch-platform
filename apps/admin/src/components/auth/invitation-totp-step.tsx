import { useMutation } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState } from 'react';

import { TotpQrCode } from '../../../lib/components/auth/totp-qr-code.tsx';
import { DateTime } from '../../../lib/components/datetime/date-time.tsx';
import { AppForm } from '../../../lib/components/form/app-form.tsx';
import { FormField } from '../../../lib/components/form/form-field.tsx';
import { FormMessage } from '../../../lib/components/form/form-message.tsx';
import { SubmitButton } from '../../../lib/components/form/submit-button.tsx';
import { useAppForm } from '../../../lib/components/form/use-app-form.ts';
import { Input } from '../../../lib/components/ui/input/input.tsx';
import { graphqlMutationOptions } from '../../../lib/start/graphql/graphql-query-options.ts';
import { isInvalidLinkError } from '../../../lib/utilities/auth/invalid-link.ts';
import {
  errorMessageOf,
  GraphQLClientError,
} from '../../../lib/utilities/graphql/graphql-result.ts';
import { TOTP_QR_CODE_LABEL } from '../../../lib/utilities/messages/auth-messages.ts';
import { ADMIN_PROFILE } from '../../composition/app-profile.ts';
import { AdminCompleteInvitationDocument } from '../../graphql/generated/graphql.ts';
import {
  INVITATION_COMPLETE_SUBMIT_LABEL,
  REQUIRED_SUFFIX,
  SECOND_FACTOR_FORM_LABEL,
  TOTP_CODE_DESCRIPTION,
  TOTP_CODE_LABEL,
  TOTP_MANUAL_ENTRY_LABEL,
  TOTP_SETUP_DESCRIPTION,
  TOTP_SETUP_EXPIRES_PREFIX,
  TOTP_SETUP_EXPIRES_SUFFIX,
  TOTP_SETUP_HEADING,
} from './admin-auth-messages.ts';
import {
  INVITATION_TOTP_FORM_SCHEMA,
  type InvitationTotpFormInput,
} from './auth-form-schemas.ts';
import type { InvitationTotpSetup } from './invitation-profile-step.tsx';

export interface InvitationTotpStepProps {
  readonly token: string;
  readonly setup: InvitationTotpSetup;
  readonly onCompleted: (recoveryCodes: readonly string[]) => void;
  readonly onExpired: (message: string) => void;
  readonly onInvalidLink: () => void;
}

const DEFAULT_VALUES: InvitationTotpFormInput = Object.freeze({
  totpCode: '',
});

// 誤った認証コードの拒否は詳細を持たないため、入力した欄の誤りとして示す
const INVALID_SECOND_FACTOR_CODE = 'invalid_second_factor';

const TOTP_SETUP_EXPIRED_CODE = 'totp_setup_expired';

const hasCode = (error: unknown, code: string): error is GraphQLClientError =>
  error instanceof GraphQLClientError && error.code === code;

export function InvitationTotpStep({
  token,
  setup,
  onCompleted,
  onExpired,
  onInvalidLink,
}: InvitationTotpStepProps) {
  const form = useAppForm(INVITATION_TOTP_FORM_SCHEMA, {
    defaultValues: DEFAULT_VALUES,
  });
  // リカバリコードの平文を変更の結果の保管場所に残さないよう、結果を渡したら消し、保持もしない
  const complete = useMutation({
    ...graphqlMutationOptions(AdminCompleteInvitationDocument),
    gcTime: 0,
  });
  const [submitError, setSubmitError] = useState<string>();
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);

  // 送信したボタンは描かれなくなるため、QRコードの説明から読めるよう段階の見出しへフォーカスを移す
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-5">
      <h2
        id={headingId}
        ref={headingRef}
        tabIndex={-1}
        className="text-lg font-semibold"
      >
        {TOTP_SETUP_HEADING}
      </h2>
      <p className="text-sm text-muted-foreground">{TOTP_SETUP_DESCRIPTION}</p>
      <div className="flex flex-col items-center gap-4">
        <TotpQrCode uri={setup.otpauthUri} label={TOTP_QR_CODE_LABEL} />
        <div className="flex w-full min-w-0 flex-col gap-2 text-sm">
          <p>{TOTP_MANUAL_ENTRY_LABEL}</p>
          <code
            translate="no"
            className="rounded-md border border-border bg-muted px-3 py-2 font-mono break-all text-foreground"
          >
            {setup.secret}
          </code>
          <p className="text-muted-foreground">
            {TOTP_SETUP_EXPIRES_PREFIX}
            <DateTime value={setup.expiresAt} format="time" />
            {TOTP_SETUP_EXPIRES_SUFFIX}
          </p>
        </div>
      </div>
      <AppForm
        form={form}
        aria-label={SECOND_FACTOR_FORM_LABEL}
        onSubmit={async ({ totpCode }) => {
          setSubmitError(undefined);
          const { completeAdminInvitation } = await complete.mutateAsync({
            variables: { token, totpCode },
          });
          complete.reset();
          onCompleted(completeAdminInvitation.codes);
        }}
        onSubmitError={(error) => {
          if (isInvalidLinkError(error)) {
            onInvalidLink();
            return;
          }
          if (hasCode(error, TOTP_SETUP_EXPIRED_CODE)) {
            onExpired(error.message);
            return;
          }
          const message = errorMessageOf(error, ADMIN_PROFILE.contactAvailable);
          if (hasCode(error, INVALID_SECOND_FACTOR_CODE)) {
            form.setError(
              'totpCode',
              { type: 'server', message },
              { shouldFocus: true },
            );
            return;
          }
          setSubmitError(message);
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
          {(control) => (
            <Input
              {...control}
              autoComplete="one-time-code"
              inputMode="numeric"
              aria-required
            />
          )}
        </FormField>
        <SubmitButton className="self-start">
          {INVITATION_COMPLETE_SUBMIT_LABEL}
        </SubmitButton>
      </AppForm>
    </section>
  );
}
