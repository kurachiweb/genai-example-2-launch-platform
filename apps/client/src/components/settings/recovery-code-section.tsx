import { useMutation } from '@tanstack/react-query';
import { TriangleAlertIcon } from 'lucide-react';
import { useRef, useState } from 'react';

import { graphqlMutationOptions } from '../../../lib/start/graphql/graphql-query-options.ts';
import { ClientRegenerateRecoveryCodesDocument } from '../../graphql/generated/graphql.ts';
import { ReauthenticatedActionForm } from './reauthenticated-action-form.tsx';
import { RecoveryCodesDialog } from './recovery-codes-dialog.tsx';
import { SettingsSection } from './settings-section.tsx';
import {
  RECOVERY_CODE_REGENERATE_FORM_LABEL,
  RECOVERY_CODE_REGENERATE_SUBMIT_LABEL,
  RECOVERY_CODE_SECTION_DESCRIPTION,
  RECOVERY_CODE_SECTION_TITLE,
  RECOVERY_CODES_LOW_MESSAGE,
  remainingRecoveryCodesMessage,
} from './settings-messages.ts';
import { useSecurityRefresh } from './use-security-refresh.ts';

export interface RecoveryCodeSectionProps {
  readonly remainingRecoveryCodes: number;
  readonly disabled: boolean;
}

// 発行する10個のうち、この数以下になったら再発行を促す
const LOW_RECOVERY_CODES_THRESHOLD = 3;

export function RecoveryCodeSection({
  remainingRecoveryCodes,
  disabled,
}: RecoveryCodeSectionProps) {
  const remainingRef = useRef<HTMLParagraphElement>(null);
  const [codes, setCodes] = useState<readonly string[] | null>(null);
  // リカバリコードの平文を変更の結果の保管場所に残さないよう、結果を状態へ移したら消し、保持もしない
  const regenerate = useMutation({
    ...graphqlMutationOptions(ClientRegenerateRecoveryCodesDocument),
    gcTime: 0,
  });
  const refresh = useSecurityRefresh();

  return (
    <SettingsSection
      title={RECOVERY_CODE_SECTION_TITLE}
      description={<p>{RECOVERY_CODE_SECTION_DESCRIPTION}</p>}
    >
      <div className="flex flex-col gap-2">
        <p ref={remainingRef} tabIndex={-1} className="rounded-sm font-medium">
          {remainingRecoveryCodesMessage(remainingRecoveryCodes)}
        </p>
        {remainingRecoveryCodes <= LOW_RECOVERY_CODES_THRESHOLD ? (
          <p className="flex items-start gap-2 text-sm text-destructive">
            <TriangleAlertIcon
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0"
            />
            <span>{RECOVERY_CODES_LOW_MESSAGE}</span>
          </p>
        ) : null}
      </div>
      <ReauthenticatedActionForm
        label={RECOVERY_CODE_REGENERATE_FORM_LABEL}
        submitLabel={RECOVERY_CODE_REGENERATE_SUBMIT_LABEL}
        totpEnabled
        disabled={disabled}
        onSubmit={async (input) => {
          const { regenerateRecoveryCodes } = await regenerate.mutateAsync({
            variables: { input },
          });
          setCodes(regenerateRecoveryCodes.codes);
          regenerate.reset();
          void refresh();
        }}
      />
      <RecoveryCodesDialog
        codes={codes}
        onClose={() => {
          setCodes(null);
        }}
        returnFocusRef={remainingRef}
      />
    </SettingsSection>
  );
}
