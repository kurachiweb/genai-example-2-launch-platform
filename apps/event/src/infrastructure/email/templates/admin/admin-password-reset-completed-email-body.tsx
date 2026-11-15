import type { ReactNode } from 'react';

import type { AdminPasswordResetCompletedInput } from '../../../../../lib/core/email/kinds/admin.ts';
import { AdminChangedAtText } from './admin-changed-at-text.tsx';
import { AdminUnrecognizedChangeNotice } from './admin-unrecognized-change-notice.tsx';

interface AdminPasswordResetCompletedEmailBodyProps {
  readonly input: AdminPasswordResetCompletedInput;
}

export function AdminPasswordResetCompletedEmailBody({
  input,
}: AdminPasswordResetCompletedEmailBodyProps): ReactNode {
  return (
    <>
      <AdminChangedAtText
        target="パスワード"
        at={input.completedAt}
        change="再設定されました"
      />
      <AdminUnrecognizedChangeNotice />
    </>
  );
}
