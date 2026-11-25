import { createFileRoute } from '@tanstack/react-router';

import { loadCommentsPage } from '../../../components/moderation/comments/load-comments-page.ts';
import { MODERATION_PAGE_COPY } from '../../../components/moderation/shared/moderation-messages.ts';
import { toCommentModerationSearch } from '../../../components/moderation/shared/moderation-search.ts';
import { CommentsPage } from '../../../components/pages/comments-page.tsx';
import { buildAdminPageHead } from '../../../head/page-heads.ts';

// 投稿日の期間を投稿日時の範囲にする地域は描画する場所で決まるため、loaderの依存には検索パラメータをそのまま渡す
export const Route = createFileRoute('/_authenticated/comments/')({
  validateSearch: toCommentModerationSearch,
  loaderDeps: ({ search }) => search,
  loader: loadCommentsPage,
  head: () =>
    buildAdminPageHead({ title: MODERATION_PAGE_COPY.comments.title }),
  component: CommentsPage,
});
