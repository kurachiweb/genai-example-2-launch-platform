import { AdminPageHeader } from '../../../lib/components/admin/admin-page-header.tsx';
import {
  ACCOUNT_PAGE_DESCRIPTION,
  ACCOUNT_PAGE_TITLE,
} from '../account/account-messages.ts';
import { EmailChangeSection } from '../account/email-change-section.tsx';
import { PasswordChangeSection } from '../account/password-change-section.tsx';
import { ProfileSection } from '../account/profile-section.tsx';
import { RecoveryCodeSection } from '../account/recovery-code-section.tsx';
import { TotpSection } from '../account/totp-section.tsx';
import { useCurrentAdmin } from '../layout/use-current-admin.ts';

// 操作の後はログイン中の管理者を取り直すため、ルートの文脈から読んだ最新の値で各区画を描く
export function AccountPage() {
  const viewer = useCurrentAdmin();

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8">
      <AdminPageHeader
        title={ACCOUNT_PAGE_TITLE}
        description={ACCOUNT_PAGE_DESCRIPTION}
      />
      <ProfileSection viewer={viewer} />
      <EmailChangeSection currentEmail={viewer.email} />
      <PasswordChangeSection />
      <TotpSection />
      <RecoveryCodeSection
        remainingRecoveryCodes={viewer.remainingRecoveryCodes}
      />
    </div>
  );
}
