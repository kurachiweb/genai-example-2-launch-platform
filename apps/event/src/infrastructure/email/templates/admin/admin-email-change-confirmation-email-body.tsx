import { Text } from '@react-email/components';
import type { ReactNode } from 'react';

import type { AdminEmailChangeConfirmationInput } from '../../../../../lib/core/email/kinds/admin.ts';
import { AdminLinkExpiryText } from './admin-link-expiry-text.tsx';

interface AdminEmailChangeConfirmationEmailBodyProps {
  readonly input: AdminEmailChangeConfirmationInput;
}

export function AdminEmailChangeConfirmationEmailBody({
  input,
}: AdminEmailChangeConfirmationEmailBodyProps): ReactNode {
  return (
    <>
      <Text>
        管理者アカウントのメールアドレスをこのメールアドレスへ変更する手続きを受け付けました。下のボタンから変更を確定してください。
      </Text>
      <AdminLinkExpiryText
        expiresAt={input.expiresAt}
        afterExpiry="期限を過ぎた場合は、もう一度手続きをしてください。"
      />
      <Text>
        このメールにお心当たりが無い場合は、何もしなくて構いません。メールアドレスは変更されません。
      </Text>
    </>
  );
}
