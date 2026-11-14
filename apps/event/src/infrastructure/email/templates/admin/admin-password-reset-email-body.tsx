import { Text } from '@react-email/components';
import type { ReactNode } from 'react';

import type { AdminPasswordResetInput } from '../../../../../lib/core/email/kinds/admin.ts';
import { AdminLinkExpiryText } from './admin-link-expiry-text.tsx';

interface AdminPasswordResetEmailBodyProps {
  readonly input: AdminPasswordResetInput;
}

export function AdminPasswordResetEmailBody({
  input,
}: AdminPasswordResetEmailBodyProps): ReactNode {
  return (
    <>
      <Text>
        管理者アカウントのパスワードの再設定の手続きを受け付けました。下のボタンから新しいパスワードを設定してください。
      </Text>
      <AdminLinkExpiryText
        expiresAt={input.expiresAt}
        afterExpiry="期限を過ぎた場合は、もう一度手続きをしてください。"
      />
      <Text>
        このメールにお心当たりが無い場合は、何もしなくて構いません。パスワードは変更されません。
      </Text>
    </>
  );
}
