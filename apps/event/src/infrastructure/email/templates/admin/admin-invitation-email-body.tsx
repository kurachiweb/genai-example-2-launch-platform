import { Text } from '@react-email/components';
import type { ReactNode } from 'react';

import type { AdminInvitationInput } from '../../../../../lib/core/email/kinds/admin.ts';
import { AdminLinkExpiryText } from './admin-link-expiry-text.tsx';

interface AdminInvitationEmailBodyProps {
  readonly input: AdminInvitationInput;
}

export function AdminInvitationEmailBody({
  input,
}: AdminInvitationEmailBodyProps): ReactNode {
  return (
    <>
      <Text>
        管理者アカウントに招待されました。下のボタンからニックネーム・パスワード・認証アプリを設定すると、管理画面を使えるようになります。
      </Text>
      <AdminLinkExpiryText
        expiresAt={input.expiresAt}
        afterExpiry="期限を過ぎた場合は、招待した管理者に招待の再送を依頼してください。"
      />
      <Text>
        このメールにお心当たりが無い場合は、何もしなくて構いません。設定を完了しない限り、管理者アカウントは使えるようになりません。
      </Text>
    </>
  );
}
