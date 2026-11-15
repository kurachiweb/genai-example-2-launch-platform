import { useRouter } from '@tanstack/react-router';

import { ErrorState } from '../../../lib/components/state/error-state.tsx';
import { CONTACT_HREF, SITE_NAME } from '../layout/site-links.ts';
import { TOP_PAGE_HEADING_ID } from './top-page-heading-id.ts';
import { TOP_PAGE_ERROR_MESSAGE } from './top-page-messages.ts';

// 再試行でloaderを実行し直すと失敗の表示が描き直されて押したボタンが消えるため、描き直した後のページの見出し(成功すればトップページ、再び失敗すればこの見出し)へフォーカスを移して<body>へ落とさない
export function TopPageError() {
  const router = useRouter();
  const retry = () => {
    void router.invalidate().then(() => {
      document.getElementById(TOP_PAGE_HEADING_ID)?.focus();
    });
  };

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-10">
      <h1 id={TOP_PAGE_HEADING_ID} tabIndex={-1} className="sr-only">
        {SITE_NAME}
      </h1>
      <ErrorState
        className="mx-auto max-w-xl"
        message={TOP_PAGE_ERROR_MESSAGE}
        onRetry={retry}
        contactHref={CONTACT_HREF}
      />
    </div>
  );
}
