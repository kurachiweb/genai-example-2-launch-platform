import { useMutation } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { notify } from '../../../lib/components/feedback/notify.ts';
import { graphqlMutationOptions } from '../../../lib/start/graphql/graphql-query-options.ts';
import {
  ClientDisableTotpDocument,
  ClientStartTotpSetupDocument,
} from '../../graphql/generated/graphql.ts';
import { ReauthenticatedActionForm } from './reauthenticated-action-form.tsx';
import { SettingsSection } from './settings-section.tsx';
import {
  TOTP_DISABLE_FORM_LABEL,
  TOTP_DISABLE_SUBMIT_LABEL,
  TOTP_DISABLED_MESSAGE,
  TOTP_DISABLED_STATUS,
  TOTP_ENABLED_STATUS,
  TOTP_SECTION_DESCRIPTION,
  TOTP_SECTION_TITLE,
  TOTP_START_FORM_LABEL,
  TOTP_START_SUBMIT_LABEL,
} from './settings-messages.ts';
import { type TotpSetup, TotpSetupDialog } from './totp-setup-dialog.tsx';
import { useSecurityRefresh } from './use-security-refresh.ts';

export interface TotpSectionProps {
  readonly totpEnabled: boolean;
  readonly disabled: boolean;
}

export function TotpSection({ totpEnabled, disabled }: TotpSectionProps) {
  const statusRef = useRef<HTMLParagraphElement>(null);
  const previousEnabledRef = useRef(totpEnabled);
  const [setup, setSetup] = useState<TotpSetup | null>(null);
  // 秘密鍵の平文を変更の結果の保管場所に残さないよう、結果を状態へ移したら消し、保持もしない
  const startSetup = useMutation({
    ...graphqlMutationOptions(ClientStartTotpSetupDocument),
    gcTime: 0,
  });
  const disableTotp = useMutation(
    graphqlMutationOptions(ClientDisableTotpDocument),
  );
  const refresh = useSecurityRefresh();

  // 無効化の後は押した送信ボタンがフォームごと消えるため、残る状態の文へフォーカスを移す。設定のダイアログを開いている間は閉じた時に移す
  useEffect(() => {
    if (previousEnabledRef.current === totpEnabled) {
      return;
    }
    previousEnabledRef.current = totpEnabled;
    if (setup === null) {
      statusRef.current?.focus();
    }
  }, [totpEnabled, setup]);

  return (
    <SettingsSection
      title={TOTP_SECTION_TITLE}
      description={<p>{TOTP_SECTION_DESCRIPTION}</p>}
    >
      <p ref={statusRef} tabIndex={-1} className="rounded-sm font-medium">
        {totpEnabled ? TOTP_ENABLED_STATUS : TOTP_DISABLED_STATUS}
      </p>
      {totpEnabled ? (
        <ReauthenticatedActionForm
          key="disable"
          label={TOTP_DISABLE_FORM_LABEL}
          submitLabel={TOTP_DISABLE_SUBMIT_LABEL}
          submitVariant="destructive"
          totpEnabled
          disabled={disabled}
          onSubmit={async (input) => {
            await disableTotp.mutateAsync({ variables: { input } });
            notify.success(TOTP_DISABLED_MESSAGE);
            await refresh();
          }}
        />
      ) : (
        <ReauthenticatedActionForm
          key="start"
          label={TOTP_START_FORM_LABEL}
          submitLabel={TOTP_START_SUBMIT_LABEL}
          totpEnabled={false}
          disabled={disabled}
          onSubmit={async (input) => {
            const { startTotpSetup } = await startSetup.mutateAsync({
              variables: { input },
            });
            setSetup(startTotpSetup);
            startSetup.reset();
          }}
        />
      )}
      <TotpSetupDialog
        setup={setup}
        onClose={() => {
          setSetup(null);
        }}
        onEnabled={() => {
          void refresh();
        }}
        returnFocusRef={statusRef}
      />
    </SettingsSection>
  );
}
