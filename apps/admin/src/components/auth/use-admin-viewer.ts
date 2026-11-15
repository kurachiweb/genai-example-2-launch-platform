import { useQuery } from '@tanstack/react-query';

import {
  type AdminViewer,
  adminViewerQueryOptions,
  toAdminViewer,
} from '../../graphql/admin-viewer.ts';

// 画面シェルの区画は認証の画面・404・エラーのページにも描かれルートの文脈を読めないため、ルートのbeforeLoadが入れた取得のキャッシュから読む。取得の失敗と取得前は未ログインとして扱う
export function useAdminViewer(): AdminViewer | null {
  const { data } = useQuery({
    ...adminViewerQueryOptions(),
    select: toAdminViewer,
  });
  return data ?? null;
}
