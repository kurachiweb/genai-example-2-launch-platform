import { useQuery } from '@tanstack/react-query';

import {
  type ClientViewer,
  toClientViewer,
  viewerQueryOptions,
} from '../../graphql/viewer.ts';

// ヘッダーの区画はエラーと404のページにも描かれルートの文脈を読めないため、ルートのbeforeLoadが入れた取得のキャッシュから読む。取得の失敗と取得前は未ログインとして扱う
export function useViewer(): ClientViewer | null {
  const { data } = useQuery({
    ...viewerQueryOptions(),
    select: toClientViewer,
  });
  return data ?? null;
}
