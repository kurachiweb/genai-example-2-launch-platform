import { Text } from '@react-email/components';
import type { ReactNode } from 'react';

import type { PasswordResetInput } from '../../../../../lib/core/email/kinds/identity.ts';
import { LinkExpiryText } from './link-expiry-text.tsx';

interface PasswordResetEmailBodyProps {
  readonly input: PasswordResetInput;
}

export function PasswordResetEmailBody({
  input,
}: PasswordResetEmailBodyProps): ReactNode {
  return (
    <>
      <Text>
        パスワードの再設定の手続きを受け付けました。下のボタンから新しいパスワードを設定してください。
      </Text>
      <LinkExpiryText expiresAt={input.expiresAt} />
      <Text>
        このメールにお心当たりが無い場合は、何もしなくて構いません。パスワードは変更されません。
      </Text>
    </>
  );
}
