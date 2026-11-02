import { Text } from '@react-email/components';
import type { ReactNode } from 'react';

import type { IdentityConfirmationInput } from '../../../../../lib/core/email/kinds/identity.ts';
import { LinkExpiryText } from './link-expiry-text.tsx';

interface EmailChangeConfirmationEmailBodyProps {
  readonly input: IdentityConfirmationInput;
}

export function EmailChangeConfirmationEmailBody({
  input,
}: EmailChangeConfirmationEmailBodyProps): ReactNode {
  return (
    <>
      <Text>
        アカウントのメールアドレスをこのメールアドレスへ変更する手続きを受け付けました。下のボタンから変更を確定してください。
      </Text>
      <LinkExpiryText expiresAt={input.expiresAt} />
      <Text>
        このメールにお心当たりが無い場合は、何もしなくて構いません。メールアドレスは変更されません。
      </Text>
    </>
  );
}
