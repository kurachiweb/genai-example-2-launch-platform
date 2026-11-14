import type { ClientViewer } from '../../graphql/viewer.ts';
import { EmailChangeSection } from './email-change-section.tsx';
import { PasswordChangeSection } from './password-change-section.tsx';
import {
  ACCOUNT_SETTINGS_PAGE_TITLE,
  SUSPENDED_ACCOUNT_NOTICE_LEAD,
} from './settings-messages.ts';
import { SuspendedAccountNotice } from './suspended-account-notice.tsx';
import { WithdrawalSection } from './withdrawal-section.tsx';

export interface AccountSettingsPageProps {
  readonly viewer: ClientViewer;
}

// 停止中の利用者は重要な操作のうち退会だけを行えるため、メールアドレス変更とパスワード変更の入力と送信を無効にする
export function AccountSettingsPage({ viewer }: AccountSettingsPageProps) {
  const suspended = viewer.status === 'SUSPENDED';

  return (
    <>
      <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">
        {ACCOUNT_SETTINGS_PAGE_TITLE}
      </h1>
      {suspended ? (
        <SuspendedAccountNotice lead={SUSPENDED_ACCOUNT_NOTICE_LEAD} />
      ) : null}
      <EmailChangeSection
        totpEnabled={viewer.totpEnabled}
        disabled={suspended}
      />
      <PasswordChangeSection
        totpEnabled={viewer.totpEnabled}
        disabled={suspended}
      />
      <WithdrawalSection totpEnabled={viewer.totpEnabled} />
    </>
  );
}
