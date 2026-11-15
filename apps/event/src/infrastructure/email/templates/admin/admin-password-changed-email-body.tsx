import type { ReactNode } from 'react';

import type { AdminChangedInput } from '../../../../../lib/core/email/kinds/admin.ts';
import { AdminChangedAtText } from './admin-changed-at-text.tsx';
import { AdminUnrecognizedChangeNotice } from './admin-unrecognized-change-notice.tsx';

interface AdminPasswordChangedEmailBodyProps {
  readonly input: AdminChangedInput;
}

export function AdminPasswordChangedEmailBody({
  input,
}: AdminPasswordChangedEmailBodyProps): ReactNode {
  return (
    <>
      <AdminChangedAtText
        target="パスワード"
        at={input.changedAt}
        change="変更されました"
      />
      <AdminUnrecognizedChangeNotice />
    </>
  );
}
