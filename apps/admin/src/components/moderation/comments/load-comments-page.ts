import { environmentManager } from '@tanstack/react-query';

import {
  appRuntimeOf,
  type RouterContext,
} from '../../../../lib/start/router-context.ts';
import { resolveBrowserDisplayPreferences } from '../../../../lib/utilities/datetime/display-preferences.ts';
import { loadAdminModerationCommentsPage } from '../../../graphql/admin-moderation-engagement.ts';
import {
  type CommentModerationSearch,
  commentModerationListArgsOf,
} from '../shared/moderation-search.ts';

type CommentsPageContext = Pick<RouterContext, 'queryClient' | 'runtime'>;

// 部品は日時の表示と同じ地域の暦(描画中とハイドレーションはサーバーの表示設定、その後はブラウザの地域)で投稿日の期間を決めるため、先に取得するキーも同じ地域で作る
const periodTimeZoneOf = (context: CommentsPageContext): string =>
  environmentManager.isServer()
    ? appRuntimeOf(context).display.timeZone
    : resolveBrowserDisplayPreferences().timeZone;

export async function loadCommentsPage({
  context,
  deps,
  cause,
}: {
  readonly context: CommentsPageContext;
  readonly deps: CommentModerationSearch;
  readonly cause: 'preload' | 'enter' | 'stay';
}): Promise<void> {
  await loadAdminModerationCommentsPage({
    context,
    deps: commentModerationListArgsOf(deps, periodTimeZoneOf(context)),
    cause,
  });
}
