import { useRouter } from '@tanstack/react-router';
import { type RefObject, useEffect, useRef } from 'react';

import {
  type DirectoryQuery,
  withConditions,
} from '../../../common-lib/directory/directory-query-rules.ts';
import { directoryHref } from './directory-href.ts';
import type { DirectoryFilterPatch } from './filter-sheet-draft.ts';

export interface DirectoryNavigation {
  // ページの移動の後にスクロールで先頭を合わせる一覧の領域
  readonly listRef: RefObject<HTMLElement | null>;
  // ページの移動と再試行の後のフォーカスの移り先(tabIndex={-1})
  readonly headingRef: RefObject<HTMLHeadingElement | null>;
  readonly changeConditions: (patch: DirectoryFilterPatch) => void;
  readonly search: (q: string | undefined) => void;
  // ページ送りのリンクが遷移を始める前に呼ぶ
  readonly onPageNavigate: () => void;
}

const prefersReducedMotion = (): boolean =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const moveToList = (
  list: HTMLElement | null,
  heading: HTMLHeadingElement | null,
): void => {
  list?.scrollIntoView({
    block: 'start',
    behavior: prefersReducedMotion() ? 'auto' : 'smooth',
  });
  // 見出しへのフォーカスで即座にスクロールすると、上の滑らかなスクロールが打ち消されるため止める
  heading?.focus({ preventScroll: true });
};

// 条件の変更は検索欄と絞り込み欄の位置に留まって結果を待てるよう、1ページ目へ戻してもスクロールを先頭へ戻さない。
// ページの移動は新しいページを一覧の先頭から読めるよう、一覧の先頭へスクロールして見出しへフォーカスを移す
export function useDirectoryNavigation(
  query: DirectoryQuery,
): DirectoryNavigation {
  const router = useRouter();
  const listRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const pendingRef = useRef<(() => void) | null>(null);

  useEffect(
    () => () => {
      pendingRef.current?.();
      pendingRef.current = null;
    },
    [],
  );

  const navigateTo = (next: DirectoryQuery): void => {
    void router.navigate({ href: directoryHref(next), resetScroll: false });
  };

  return {
    listRef,
    headingRef,
    changeConditions: (patch) => {
      navigateTo(withConditions(query, patch));
    },
    search: (q) => {
      navigateTo(withConditions(query, { q }));
    },
    // ルーターは描画の後にスクロールを先頭へ戻すため、その処理の後(同じ描画の通知の後の購読者)で一覧の先頭へ移る
    onPageNavigate: () => {
      pendingRef.current?.();
      const unsubscribe = router.subscribe('onRendered', () => {
        unsubscribe();
        pendingRef.current = null;
        moveToList(listRef.current, headingRef.current);
      });
      pendingRef.current = unsubscribe;
    },
  };
}
