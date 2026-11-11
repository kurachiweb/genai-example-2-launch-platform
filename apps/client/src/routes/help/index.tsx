import { createFileRoute, useRouter } from '@tanstack/react-router';

import { normalizeHelpTopQuery } from '../../../common-lib/help/help-query-rules.ts';
import { HelpTopContent } from '../../components/help/help-top-content.tsx';
import { HelpTopError } from '../../components/help/help-top-error.tsx';
import { HelpTopFrame } from '../../components/help/help-top-frame.tsx';
import { HelpTopSkeleton } from '../../components/help/help-top-skeleton.tsx';
import { loadHelpTopPage } from '../../graphql/help-center.ts';
import { buildHelpTopHead } from '../../head/page-heads.ts';

// 空白だけの検索語は検証で外れ、50文字を超える検索語は切り詰められ、ルーターがURLを正規化した検索語へ置き換える(サーバーでの描画では転送する)。
// 読み込み中と失敗の画面は最初の表示だけに使い、同じページの中の検索では画面が一覧の位置に示す
export const Route = createFileRoute('/help/')({
  validateSearch: normalizeHelpTopQuery,
  loaderDeps: ({ search: { q } }) => ({ q }),
  loader: loadHelpTopPage,
  head: buildHelpTopHead,
  pendingComponent: HelpTopPending,
  errorComponent: HelpTopFailure,
  component: HelpTopRoute,
});

function HelpTopRoute() {
  const { q } = Route.useSearch();
  return (
    <HelpTopFrame query={q}>
      <HelpTopContent query={q} />
    </HelpTopFrame>
  );
}

function HelpTopPending() {
  const { q } = Route.useSearch();
  return (
    <HelpTopFrame query={q}>
      <HelpTopSkeleton />
    </HelpTopFrame>
  );
}

function HelpTopFailure() {
  const { q } = Route.useSearch();
  const router = useRouter();
  return (
    <HelpTopFrame query={q}>
      <HelpTopError onRetry={() => router.invalidate()} />
    </HelpTopFrame>
  );
}
