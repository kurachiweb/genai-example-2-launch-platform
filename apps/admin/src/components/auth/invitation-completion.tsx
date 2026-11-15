import { Link } from '@tanstack/react-router';
import { useState } from 'react';

import { RecoveryCodeList } from '../../../lib/components/auth/recovery-code-list.tsx';
import { useFragmentToken } from '../../../lib/components/auth/use-fragment-token.ts';
import { ResultNotice } from '../../../lib/components/feedback/result-notice.tsx';
import { Button } from '../../../lib/components/ui/button/button.tsx';
import { HOME_PATH } from '../../../lib/utilities/auth/return-path.ts';
import {
  INVALID_LINK_MESSAGE,
  INVITATION_COMPLETED_MESSAGE,
  INVITATION_RESEND_REQUEST_MESSAGE,
  PROCEED_TO_DASHBOARD_LABEL,
  RECOVERY_CODES_SHOWN_ONCE_MESSAGE,
} from './admin-auth-messages.ts';
import {
  InvitationProfileStep,
  type InvitationTotpSetup,
} from './invitation-profile-step.tsx';
import { InvitationTotpStep } from './invitation-totp-step.tsx';
import { useAdminViewerRefresh } from './use-admin-viewer-refresh.ts';

type InvitationState =
  | { readonly step: 'profile'; readonly restartReason?: string }
  | { readonly step: 'totp'; readonly setup: InvitationTotpSetup }
  | { readonly step: 'completed'; readonly recoveryCodes: readonly string[] }
  | { readonly step: 'invalid' };

const INITIAL_STATE: InvitationState = Object.freeze({ step: 'profile' });

// 招待のリンクを開いただけでは送信せず、ニックネームとパスワード→認証アプリの設定と認証コード→リカバリコードの表示の順に進める
export function InvitationCompletion() {
  const link = useFragmentToken();
  const [state, setState] = useState<InvitationState>(INITIAL_STATE);
  const refreshViewer = useAdminViewerRefresh();

  if (link.status === 'reading') {
    return null;
  }

  const showInvalidLink = () => {
    setState({ step: 'invalid' });
  };

  if (link.status === 'missing' || state.step === 'invalid') {
    return (
      <ResultNotice tone="error" message={INVALID_LINK_MESSAGE}>
        <p>{INVITATION_RESEND_REQUEST_MESSAGE}</p>
      </ResultNotice>
    );
  }

  if (state.step === 'totp') {
    return (
      <InvitationTotpStep
        token={link.token}
        setup={state.setup}
        onCompleted={(recoveryCodes) => {
          setState({ step: 'completed', recoveryCodes });
          // 完了はこの端末へセッションを発行するため、画面シェルの区画をログイン中に描き直させる。この画面はログイン中でも移動しないため、リカバリコードの表示が残る
          void refreshViewer();
        }}
        onExpired={(restartReason) => {
          setState({ step: 'profile', restartReason });
        }}
        onInvalidLink={showInvalidLink}
      />
    );
  }

  if (state.step === 'completed') {
    return (
      <div className="flex flex-col gap-5">
        <ResultNotice tone="success" message={INVITATION_COMPLETED_MESSAGE}>
          <p>{RECOVERY_CODES_SHOWN_ONCE_MESSAGE}</p>
        </ResultNotice>
        <RecoveryCodeList codes={state.recoveryCodes} />
        <Button asChild className="self-start">
          <Link to={HOME_PATH}>{PROCEED_TO_DASHBOARD_LABEL}</Link>
        </Button>
      </div>
    );
  }

  return (
    <InvitationProfileStep
      token={link.token}
      {...(state.restartReason === undefined
        ? {}
        : { restartReason: state.restartReason })}
      onStarted={(setup) => {
        setState({ step: 'totp', setup });
      }}
      onInvalidLink={showInvalidLink}
    />
  );
}
