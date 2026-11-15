import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { useEffect } from 'react';

import type { DirectoryQuery } from '../../../common-lib/directory/directory-query-rules.ts';
import {
  directoryQueryOfApplied,
  directoryQueryOptions,
} from '../../graphql/directory.ts';
import type { ClientViewer } from '../../graphql/viewer.ts';
import { directoryHref } from './directory-href.ts';

// 存在しないカテゴリや大文字のハンドルのように、サーバーが解決した条件がURLと食い違えば、履歴を増やさずにURLを解決した条件へ合わせる。
// 解決した条件の結果は取得済みの結果と同じため、キャッシュへ写して取得し直さず、読み込み中の表示も出さない
export function useAppliedDirectoryQuery(
  query: DirectoryQuery,
  viewer: ClientViewer | null,
): void {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: appliedHref } = useQuery({
    ...directoryQueryOptions(query, viewer),
    select: ({ directory }) =>
      directoryHref(directoryQueryOfApplied(directory.applied)),
  });
  const currentHref = directoryHref(query);

  useEffect(() => {
    if (appliedHref === undefined || appliedHref === currentHref) {
      return;
    }
    const data = queryClient.getQueryData(
      directoryQueryOptions(query, viewer).queryKey,
    );
    if (data !== undefined) {
      queryClient.setQueryData(
        directoryQueryOptions(
          directoryQueryOfApplied(data.directory.applied),
          viewer,
        ).queryKey,
        data,
      );
    }
    void router.navigate({
      href: appliedHref,
      replace: true,
      resetScroll: false,
    });
  }, [appliedHref, currentHref, query, viewer, queryClient, router]);
}
