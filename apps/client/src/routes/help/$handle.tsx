import { createFileRoute, notFound } from '@tanstack/react-router';

import { NotFoundPage } from '../../components/pages/not-found-page.tsx';

// 記事詳細の画面ができるまでは、ヘルプトップの項目のリンク先を存在しないページにする
export const Route = createFileRoute('/help/$handle')({
  loader: () => {
    throw notFound();
  },
  notFoundComponent: NotFoundPage,
});
