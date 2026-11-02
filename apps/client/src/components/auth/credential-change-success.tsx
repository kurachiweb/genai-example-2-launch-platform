import { Link } from '@tanstack/react-router';

import { HOME_LINK_LABEL, LOGIN_PAGE_LINK_LABEL } from './account-messages.ts';
import { INLINE_LINK_CLASS_NAME } from './inline-link-class.ts';
import { ResultNotice } from './result-notice.tsx';
import { HOME_PATH } from './return-path.ts';

export interface CredentialChangeSuccessProps {
  readonly message: string;
  readonly loginMessage: string;
  readonly signedIn: boolean;
}

// 確定はすべての端末のセッションを消し、確定した端末が同じ利用者としてログイン中だった時だけ新しいセッションを発行するため、発行されなければログインへ案内する
export function CredentialChangeSuccess({
  message,
  loginMessage,
  signedIn,
}: CredentialChangeSuccessProps) {
  if (signedIn) {
    return (
      <ResultNotice tone="success" message={message}>
        <Link to={HOME_PATH} className={INLINE_LINK_CLASS_NAME}>
          {HOME_LINK_LABEL}
        </Link>
      </ResultNotice>
    );
  }
  return (
    <ResultNotice tone="success" message={`${message}${loginMessage}`}>
      <Link to="/auth/login" className={INLINE_LINK_CLASS_NAME}>
        {LOGIN_PAGE_LINK_LABEL}
      </Link>
    </ResultNotice>
  );
}
