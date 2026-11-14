import { Text } from '@react-email/components';
import type { ReactNode } from 'react';

import type { EmailVerificationInput } from '../../../../../lib/core/email/kinds/identity.ts';
import { LinkExpiryText } from './link-expiry-text.tsx';

interface EmailVerificationEmailBodyProps {
  readonly input: EmailVerificationInput;
}

export function EmailVerificationEmailBody({
  input,
}: EmailVerificationEmailBodyProps): ReactNode {
  return (
    <>
      <Text>
        ご登録ありがとうございます。下のボタンからメールアドレスを確認すると、登録が完了します。
      </Text>
      <LinkExpiryText expiresAt={input.expiresAt} />
      <Text>
        このメールにお心当たりが無い場合は、何もしなくて構いません。メールアドレスの確認は行われません。
      </Text>
    </>
  );
}
