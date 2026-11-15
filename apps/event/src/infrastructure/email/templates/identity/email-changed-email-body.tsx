import { Text } from '@react-email/components';
import type { ReactNode } from 'react';

import type { IdentityChangedInput } from '../../../../../lib/core/email/kinds/identity.ts';
import { ChangedAtText } from './changed-at-text.tsx';
import { UnrecognizedChangeNotice } from './unrecognized-change-notice.tsx';

interface EmailChangedEmailBodyProps {
  readonly input: IdentityChangedInput;
}

export function EmailChangedEmailBody({
  input,
}: EmailChangedEmailBodyProps): ReactNode {
  return (
    <>
      <ChangedAtText
        target="メールアドレス"
        at={input.changedAt}
        change="変更されました"
      />
      <Text>このメールは変更前のメールアドレスにお送りしています。</Text>
      <UnrecognizedChangeNotice />
    </>
  );
}
