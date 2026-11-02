import { Text } from '@react-email/components';
import type { ReactNode } from 'react';

import type { IdentityConfirmationInput } from '../../../../../lib/core/email/kinds/identity.ts';
import { LinkExpiryText } from './link-expiry-text.tsx';

interface PasswordChangeConfirmationEmailBodyProps {
  readonly input: IdentityConfirmationInput;
}

export function PasswordChangeConfirmationEmailBody({
  input,
}: PasswordChangeConfirmationEmailBodyProps): ReactNode {
  return (
    <>
      <Text>
        パスワードの変更の手続きを受け付けました。下のボタンから変更を確定すると、新しいパスワードに切り替わります。
      </Text>
      <LinkExpiryText expiresAt={input.expiresAt} />
      <Text>
        このメールにお心当たりが無い場合は、何もしなくて構いません。パスワードは変更されません。
      </Text>
    </>
  );
}
