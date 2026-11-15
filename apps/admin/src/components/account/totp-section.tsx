import { useMutation } from '@tanstack/react-query';
import { useRef, useState } from 'react';

import { graphqlMutationOptions } from '../../../lib/start/graphql/graphql-query-options.ts';
import { AdminStartTotpResetDocument } from '../../graphql/generated/graphql.ts';
import { useAdminViewerRefresh } from '../auth/use-admin-viewer-refresh.ts';
import {
  TOTP_RESET_LABEL,
  TOTP_RESET_START_LABEL,
  TOTP_SECTION_DESCRIPTION,
  TOTP_SECTION_TITLE,
} from './account-messages.ts';
import { AccountSection } from './account-section.tsx';
import { ReauthenticatedActionForm } from './reauthenticated-action-form.tsx';
import { TotpResetDialog, type TotpResetSetup } from './totp-reset-dialog.tsx';

interface TotpResetState {
  readonly setup: TotpResetSetup | null;
  // 閉じる動きの最中に開き直すと前の入力やリカバリコードが残るため、開くたびに数を変えて中身を作り直す
  readonly session: number;
}

const INITIAL_STATE: TotpResetState = Object.freeze({
  setup: null,
  session: 0,
});

export function TotpSection() {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [reset, setReset] = useState<TotpResetState>(INITIAL_STATE);
  // 秘密鍵の平文を変更の結果の保管場所に残さないよう、結果を状態へ移したら消し、保持もしない
  const startReset = useMutation({
    ...graphqlMutationOptions(AdminStartTotpResetDocument),
    gcTime: 0,
  });
  const refreshViewer = useAdminViewerRefresh();

  return (
    <AccountSection
      title={TOTP_SECTION_TITLE}
      description={TOTP_SECTION_DESCRIPTION}
      headingRef={headingRef}
    >
      <ReauthenticatedActionForm
        label={TOTP_RESET_LABEL}
        submitLabel={TOTP_RESET_START_LABEL}
        refreshOnSuccess={false}
        onSubmit={async (variables) => {
          const { startAdminTotpReset } = await startReset.mutateAsync({
            variables,
          });
          startReset.reset();
          setReset((current) => ({
            setup: startAdminTotpReset,
            session: current.session + 1,
          }));
        }}
      />
      <TotpResetDialog
        key={reset.session}
        setup={reset.setup}
        onClose={() => {
          setReset((current) => ({ ...current, setup: null }));
        }}
        returnFocusRef={headingRef}
        onCompleted={() => {
          // 完了は全端末のセッションを消してこの端末へ発行し直し、リカバリコードの残数も変えるため、ログイン中の管理者を取り直させる
          void refreshViewer();
        }}
      />
    </AccountSection>
  );
}
