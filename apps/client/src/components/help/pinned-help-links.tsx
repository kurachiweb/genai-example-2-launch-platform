import { useQuery } from '@tanstack/react-query';

import { pinnedHelpArticlesQueryOptions } from '../../graphql/help-center.ts';

// フッターの一覧の直下に置かれるため包む要素を持たず、読み込み中と取得の失敗ではヘルプトップへのリンクだけが残るよう何も描かない
export function PinnedHelpLinks() {
  const { data } = useQuery(pinnedHelpArticlesQueryOptions());
  if (data === undefined) {
    return null;
  }
  return data.pinnedHelpArticles.map(({ handle, title }) => (
    <li key={handle}>
      <a href={`/help/${encodeURIComponent(handle)}`}>{title}</a>
    </li>
  ));
}
