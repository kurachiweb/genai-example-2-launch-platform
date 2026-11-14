import { redirect } from '@tanstack/react-router';

import type { ClientViewer } from '../../graphql/viewer.ts';

export interface RedirectSignedInViewerInput {
  readonly context: { readonly viewer: ClientViewer | null };
}

// 登録とログインの画面のbeforeLoad。ルートのbeforeLoadが文脈に入れた利用者で判定し、ログイン中ならトップページへ移す
export function redirectSignedInViewer({
  context,
}: RedirectSignedInViewerInput): void {
  if (context.viewer !== null) {
    throw redirect({ to: '/' });
  }
}
