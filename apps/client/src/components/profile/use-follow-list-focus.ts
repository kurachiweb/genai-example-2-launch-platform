import { type RefObject, useLayoutEffect, useRef } from 'react';

export interface FollowListFocus<TList extends HTMLElement> {
  readonly listRef: RefObject<TList | null>;
  readonly loadMoreRef: RefObject<HTMLButtonElement | null>;
  // 続きを読み込み始める時に、読み込む前の件数を記録する
  readonly rememberCount: (count: number) => void;
}

interface FollowListFocusInput {
  readonly entryCount: number | undefined;
  readonly loadingMore: boolean;
  readonly loadMoreFailed: boolean;
  // 記録が一覧の要素の直下に並ばない(小見出しごとの一覧に分かれる)時に、一覧の要素の中の記録の要素を選ぶセレクタ。省くと直下の要素を記録とする
  readonly itemSelector?: string;
}

const itemsOf = (
  list: HTMLElement,
  itemSelector: string | undefined,
): readonly Element[] =>
  itemSelector === undefined
    ? [...list.children]
    : [...list.querySelectorAll(itemSelector)];

// 続きを読み込んだ後に、加えた最初の項目へフォーカスを移す。最後のページでは「さらに読み込む」が消えてフォーカスが<body>へ落ちるため、描き直した後に移す
export function useFollowListFocus<
  TList extends HTMLElement = HTMLUListElement,
>({
  entryCount,
  loadingMore,
  loadMoreFailed,
  itemSelector,
}: FollowListFocusInput): FollowListFocus<TList> {
  const listRef = useRef<TList>(null);
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
    const list = listRef.current;
    if (list === null) {
      return;
    }
    const items = itemsOf(list, itemSelector);
    const target = items[Math.min(from, items.length - 1)];
    if (target instanceof HTMLElement) {
      target.focus();
    }
  }, [entryCount, loadingMore, loadMoreFailed, itemSelector]);

  return {
    listRef,
    loadMoreRef,
    rememberCount: (count) => {
      focusFromRef.current = count;
    },
  };
}
