import { type RefObject, useLayoutEffect, useRef } from 'react';

export interface AppendedRowFocus {
  // 表を包む要素。行は中の`tbody tr`
  readonly tableRef: RefObject<HTMLDivElement | null>;
  readonly loadMoreRef: RefObject<HTMLButtonElement | null>;
  // 続きを読み込み始める時に、読み込む前の行の数を記録する
  readonly rememberCount: (count: number) => void;
}

interface AppendedRowFocusInput {
  readonly rowCount: number | undefined;
  readonly loadingMore: boolean;
  readonly loadMoreFailed: boolean;
}

// 続きを読み込んだ後に、加えた最初の行へフォーカスを移す。最後のページでは「さらに読み込む」が消えてフォーカスが<body>へ落ちるため、描き直した後に移す
export function useAppendedRowFocus({
  rowCount,
  loadingMore,
  loadMoreFailed,
}: AppendedRowFocusInput): AppendedRowFocus {
  const tableRef = useRef<HTMLDivElement>(null);
  const loadMoreRef = useRef<HTMLButtonElement>(null);
  const focusFromRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    const from = focusFromRef.current;
    if (from === null || loadingMore) {
      return;
    }
    focusFromRef.current = null;
    // 失敗した時は「さらに読み込む」が残るため、フォーカスを動かさない
    if (loadMoreFailed) {
      return;
    }
    // 読み込みを待つ間に利用者が「さらに読み込む」の外へ移したフォーカスは奪い返さない
    const active = document.activeElement;
    if (
      active !== null &&
      active !== document.body &&
      active !== loadMoreRef.current
    ) {
      return;
    }
    const rows = [
      ...(tableRef.current?.querySelectorAll<HTMLElement>('tbody tr') ?? []),
    ];
    const target = rows[Math.min(from, rows.length - 1)];
    if (target === undefined) {
      return;
    }
    // 表の行は元からフォーカスできないため、プログラムからだけフォーカスできるようにしてから移す
    target.tabIndex = -1;
    target.focus();
  }, [rowCount, loadingMore, loadMoreFailed]);

  return {
    tableRef,
    loadMoreRef,
    rememberCount: (count) => {
      focusFromRef.current = count;
    },
  };
}
