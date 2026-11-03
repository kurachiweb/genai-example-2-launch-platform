import { Text } from '@react-email/components';
import type { ReactNode } from 'react';

import type { AdminChangedInput } from '../../../../../lib/core/email/kinds/admin.ts';
import { AdminChangedAtText } from './admin-changed-at-text.tsx';
import { AdminUnrecognizedChangeNotice } from './admin-unrecognized-change-notice.tsx';

interface AdminEmailChangedEmailBodyProps {
  readonly input: AdminChangedInput;
}

export function AdminEmailChangedEmailBody({
  input,
}: AdminEmailChangedEmailBodyProps): ReactNode {
  return (
    <>
      <AdminChangedAtText
        target="メールアドレス"
        at={input.changedAt}
        change="変更されました"
      />
      <Text>このメールは変更前のメールアドレスにお送りしています。</Text>
      <AdminUnrecognizedChangeNotice />
    </>
  );
}
