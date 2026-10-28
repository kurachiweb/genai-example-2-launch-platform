import { useRouter } from '@tanstack/react-router';

import { UnexpectedErrorView } from '../../../lib/components/error/unexpected-error-view.tsx';

// エラーの境界はmatchを再設定の鍵にしており、invalidateでloaderを再び実行するとmatchが作り直されて境界も描画をやり直す
// 問い合わせのページは利用者側にだけあるため、管理者側は問い合わせへの導線を出さない
export function ErrorPage() {
  const router = useRouter();
  const retry = () => {
    void router.invalidate();
  };

  return <UnexpectedErrorView onRetry={retry} />;
}
