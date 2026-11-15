import { useMutation } from '@tanstack/react-query';
import { TriangleAlertIcon } from 'lucide-react';
import { useRef, useState } from 'react';

import { graphqlMutationOptions } from '../../../lib/start/graphql/graphql-query-options.ts';
import { AdminRegenerateRecoveryCodesDocument } from '../../graphql/generated/graphql.ts';
import {
  RECOVERY_CODE_REGENERATE_LABEL,
  RECOVERY_CODE_REGENERATE_SUBMIT_LABEL,
  RECOVERY_CODE_SECTION_DESCRIPTION,
  RECOVERY_CODE_SECTION_TITLE,
  RECOVERY_CODES_LOW_MESSAGE,
  remainingRecoveryCodesMessage,
} from './account-messages.ts';
import { AccountSection } from './account-section.tsx';
import { ReauthenticatedActionForm } from './reauthenticated-action-form.tsx';
import { RecoveryCodesDialog } from './recovery-codes-dialog.tsx';

export interface RecoveryCodeSectionProps {
  readonly remainingRecoveryCodes: number;
}

// 発行する10個のうち、この数以下になったら再発行を促す
const LOW_RECOVERY_CODES_THRESHOLD = 3;

export function RecoveryCodeSection({
  remainingRecoveryCodes,
}: RecoveryCodeSectionProps) {
  const remainingRef = useRef<HTMLParagraphElement>(null);
  const [codes, setCodes] = useState<readonly string[] | null>(null);
  // リカバリコードの平文を変更の結果の保管場所に残さないよう、結果を状態へ移したら消し、保持もしない
  const regenerate = useMutation({
    ...graphqlMutationOptions(AdminRegenerateRecoveryCodesDocument),
    gcTime: 0,
  });

  return (
    <AccountSection
      title={RECOVERY_CODE_SECTION_TITLE}
      description={RECOVERY_CODE_SECTION_DESCRIPTION}
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
        label={RECOVERY_CODE_REGENERATE_LABEL}
        submitLabel={RECOVERY_CODE_REGENERATE_SUBMIT_LABEL}
        // 再発行は全端末のセッションを消してこの端末へ発行し直し、残数も変えるため、成功の後にログイン中の管理者を取り直させる
        refreshOnSuccess
        onSubmit={async (variables) => {
          const { regenerateAdminRecoveryCodes } = await regenerate.mutateAsync(
            { variables },
          );
          regenerate.reset();
          setCodes(regenerateAdminRecoveryCodes.codes);
        }}
      />
      <RecoveryCodesDialog
        codes={codes}
        onClose={() => {
          setCodes(null);
        }}
        returnFocusRef={remainingRef}
      />
    </AccountSection>
  );
}
