import { createFileRoute } from '@tanstack/react-router';

import { requireViewer } from '../../components/auth/require-viewer.ts';

// ログイン必須の画面をまとめる経路の無いレイアウト。他のspecもログイン必須の画面をこの下に置く
export const Route = createFileRoute('/_authenticated')({
  beforeLoad: requireViewer,
});
