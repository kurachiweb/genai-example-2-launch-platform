import { redirect } from '@tanstack/react-router';

import type { AdminViewer } from '../../graphql/admin-viewer.ts';

export interface RedirectSignedInAdminInput {
  readonly context: { readonly viewer: AdminViewer | null };
}

// ログインの画面のbeforeLoad。ルートのbeforeLoadが文脈に入れた管理者で判定し、ログイン中ならダッシュボードへ移す
export function redirectSignedInAdmin({
  context,
}: RedirectSignedInAdminInput): void {
  if (context.viewer !== null) {
    throw redirect({ to: '/' });
  }
}
