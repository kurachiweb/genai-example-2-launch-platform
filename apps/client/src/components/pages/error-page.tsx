import { useRouter } from '@tanstack/react-router';

import { UnexpectedErrorView } from '../../../lib/components/error/unexpected-error-view.tsx';
import { CONTACT_HREF } from '../layout/site-links.ts';

// エラーの境界はmatchを再設定の鍵にしており、invalidateでloaderを再び実行するとmatchが作り直されて境界も描画をやり直す
export function ErrorPage() {
  const router = useRouter();
  const retry = () => {
    void router.invalidate();
  };

  return <UnexpectedErrorView onRetry={retry} contactHref={CONTACT_HREF} />;
}
