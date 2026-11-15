import type { ReactNode } from 'react';

import type { PasswordResetCompletedInput } from '../../../../../lib/core/email/kinds/identity.ts';
import { ChangedAtText } from './changed-at-text.tsx';
import { UnrecognizedChangeNotice } from './unrecognized-change-notice.tsx';

interface PasswordResetCompletedEmailBodyProps {
  readonly input: PasswordResetCompletedInput;
}

export function PasswordResetCompletedEmailBody({
  input,
}: PasswordResetCompletedEmailBodyProps): ReactNode {
  return (
    <>
      <ChangedAtText
        target="パスワード"
        at={input.completedAt}
        change="再設定されました"
      />
      <UnrecognizedChangeNotice />
    </>
  );
}
