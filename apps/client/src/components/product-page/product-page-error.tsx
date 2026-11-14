import { useRouter } from '@tanstack/react-router';

import { ErrorState } from '../../../lib/components/state/error-state.tsx';
import { CONTACT_HREF } from '../layout/site-links.ts';
import {
  PRODUCT_PAGE_ERROR_HEADING,
  PRODUCT_PAGE_ERROR_MESSAGE,
} from './product-page-messages.ts';

// 再試行でloaderを実行し直すと失敗の表示が描き直されて押したボタンが消えるため、描き直した後のページの見出し(成功すればプロダクトの名称、再び失敗すればこの見出し)へフォーカスを移して<body>へ落とさない
const focusPageHeading = (): void => {
  const heading = document.querySelector<HTMLElement>('main h1');
  if (heading === null) {
    return;
  }
  if (!heading.hasAttribute('tabindex')) {
    heading.setAttribute('tabindex', '-1');
  }
  heading.focus();
};

export function ProductPageError() {
  const router = useRouter();
  const retry = () => {
    void router.invalidate().then(focusPageHeading);
  };

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-10">
      <h1 tabIndex={-1} className="sr-only">
        {PRODUCT_PAGE_ERROR_HEADING}
      </h1>
      <ErrorState
        className="mx-auto max-w-xl"
        message={PRODUCT_PAGE_ERROR_MESSAGE}
        onRetry={retry}
        contactHref={CONTACT_HREF}
      />
    </div>
  );
}
