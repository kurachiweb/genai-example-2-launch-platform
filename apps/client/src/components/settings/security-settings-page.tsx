import { useSuspenseQuery } from '@tanstack/react-query';

import type { ClientViewer } from '../../graphql/viewer.ts';
import { mySessionsQueryOptions } from './my-sessions-query.ts';
import { RecoveryCodeSection } from './recovery-code-section.tsx';
import { SessionListSection } from './session-list-section.tsx';
import {
  SECURITY_SETTINGS_PAGE_TITLE,
  SUSPENDED_SECURITY_NOTICE_LEAD,
} from './settings-messages.ts';
import { SuspendedAccountNotice } from './suspended-account-notice.tsx';
import { TotpSection } from './totp-section.tsx';

export interface SecuritySettingsPageProps {
  readonly viewer: ClientViewer;
}

// 停止中の利用者は多要素認証を変更できないが、乗っ取りに気づいた時に他の端末を締め出せるよう、セッションの失効は行える
export function SecuritySettingsPage({ viewer }: SecuritySettingsPageProps) {
  const { data } = useSuspenseQuery(mySessionsQueryOptions(viewer.id));
  const suspended = viewer.status === 'SUSPENDED';
  // 多要素認証の操作の後に取り直す値を使い、ログイン中の利用者の値は取得の結果が無い時だけ使う
  const totpEnabled = data.viewer?.totpEnabled ?? viewer.totpEnabled;

  return (
    <>
      <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">
        {SECURITY_SETTINGS_PAGE_TITLE}
      </h1>
      {suspended ? (
        <SuspendedAccountNotice lead={SUSPENDED_SECURITY_NOTICE_LEAD} />
      ) : null}
      <SessionListSection sessions={data.mySessions} />
      <TotpSection totpEnabled={totpEnabled} disabled={suspended} />
      {totpEnabled ? (
        <RecoveryCodeSection
          remainingRecoveryCodes={data.viewer?.remainingRecoveryCodes ?? 0}
          disabled={suspended}
        />
      ) : null}
    </>
  );
}
