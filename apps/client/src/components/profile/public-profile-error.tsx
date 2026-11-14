import { useRouter } from '@tanstack/react-router';

import { ErrorState } from '../../../lib/components/state/error-state.tsx';
import { CONTACT_HREF } from '../layout/site-links.ts';
import {
  PROFILE_ERROR_MESSAGE,
  PROFILE_PAGE_LABEL,
} from './profile-messages.ts';
import { PROFILE_HEADING_ID } from './profile-heading-id.ts';

// 再試行でloaderを実行し直すと取得の失敗の表示が描き直されて押したボタンが消えるため、描き直した後の見出し(成功すればニックネーム、再び失敗すればこの見出し)へフォーカスを移して<body>へ落とさない
export function PublicProfileError() {
  const router = useRouter();
  const retry = () => {
    void router.invalidate().then(() => {
      document.getElementById(PROFILE_HEADING_ID)?.focus();
    });
  };

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-10">
      <h1 id={PROFILE_HEADING_ID} tabIndex={-1} className="sr-only rounded-sm">
        {PROFILE_PAGE_LABEL}
      </h1>
      <ErrorState
        className="mx-auto max-w-xl"
        message={PROFILE_ERROR_MESSAGE}
        onRetry={retry}
        contactHref={CONTACT_HREF}
      />
    </div>
  );
}
