import type { ReactNode } from 'react';

import type { IdentityChangedInput } from '../../../../../lib/core/email/kinds/identity.ts';
import { ChangedAtText } from './changed-at-text.tsx';
import { UnrecognizedChangeNotice } from './unrecognized-change-notice.tsx';

interface PasswordChangedEmailBodyProps {
  readonly input: IdentityChangedInput;
}

export function PasswordChangedEmailBody({
  input,
}: PasswordChangedEmailBodyProps): ReactNode {
  return (
    <>
      <ChangedAtText
        target="パスワード"
        at={input.changedAt}
        change="変更されました"
      />
      <UnrecognizedChangeNotice />
    </>
  );
}
