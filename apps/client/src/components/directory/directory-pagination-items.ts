export type DirectoryPaginationItem =
  | {
      readonly kind: 'page';
      readonly page: number;
      readonly current: boolean;
    }
  // 省いた間の直前のページの番号を持ち、並びの中の印を区別できるようにする
  | { readonly kind: 'gap'; readonly after: number };

const pageItem = (page: number, current: number): DirectoryPaginationItem => ({
  kind: 'page',
  page,
  current: page === current,
});

// 先頭・末尾・現在のページの前後1つを並べ、2ページ以上空く間だけを省略の印にする。1ページ分だけ空くときは印より番号の方が情報が多いため、その番号を出す
export function directoryPaginationItems(
  current: number,
  pageCount: number,
): readonly DirectoryPaginationItem[] {
  const shown = [...new Set([1, current - 1, current, current + 1, pageCount])]
    .filter((page) => page >= 1 && page <= pageCount)
    .toSorted((a, b) => a - b);
  return shown.flatMap((page, index): DirectoryPaginationItem[] => {
    const previous = shown[index - 1];
    if (previous === undefined || page - previous === 1) {
      return [pageItem(page, current)];
    }
    if (page - previous === 2) {
      return [pageItem(previous + 1, current), pageItem(page, current)];
    }
    return [{ kind: 'gap', after: previous }, pageItem(page, current)];
  });
}
