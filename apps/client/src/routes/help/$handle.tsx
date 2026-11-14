import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, notFound, useRouter } from '@tanstack/react-router';

import { HelpArticleError } from '../../components/help/help-article-error.tsx';
import { HelpArticlePage } from '../../components/help/help-article-page.tsx';
import { HelpArticleSkeleton } from '../../components/help/help-article-skeleton.tsx';
import { NotFoundPage } from '../../components/pages/not-found-page.tsx';
import {
  helpArticleQueryOptions,
  loadHelpArticlePage,
  toHelpArticleView,
} from '../../graphql/help-center.ts';
import { buildHelpArticleHead } from '../../head/page-heads.ts';

export const Route = createFileRoute('/help/$handle')({
  loader: loadHelpArticlePage,
  head: ({ loaderData }) => buildHelpArticleHead(loaderData),
  pendingComponent: HelpArticleSkeleton,
  errorComponent: HelpArticleFailure,
  // 表示中の取り直しで部品が投げた404も、loaderの404と同じ画面にする
  notFoundComponent: NotFoundPage,
  component: HelpArticleRoute,
});

// 表示中の取り直しで記事を表示できなくなった(下書きへ戻した・削除した・ハンドルの変更)ときは、最初の表示と同じ404にする。
// 記事ごとに目次の開閉などの状態を作り直すため、別の記事への遷移ではページを作り直す
function HelpArticleRoute() {
  const { handle } = Route.useParams();
  const { data: article } = useSuspenseQuery({
    ...helpArticleQueryOptions(handle),
    select: toHelpArticleView,
  });
  if (article === undefined) {
    throw notFound();
  }
  return <HelpArticlePage key={article.handle} article={article} />;
}

function HelpArticleFailure() {
  const router = useRouter();
  return <HelpArticleError onRetry={() => router.invalidate()} />;
}
