import { redirect } from '@tanstack/react-router';

import { hasRole } from '../../../common-lib/admin/admin-roles.ts';
import type { AuthenticatedContext } from '../auth/require-admin-viewer.ts';

// 作成の画面は閲覧のみの管理者が操作できるものを持たないため、読み込みの前にヘルプ記事の一覧へ戻す
export function requireHelpArticleEditor({
  context,
}: {
  readonly context: AuthenticatedContext;
}): void {
  if (!hasRole(context.viewer.role, 'moderator')) {
    throw redirect({ to: '/help-articles' });
  }
}
