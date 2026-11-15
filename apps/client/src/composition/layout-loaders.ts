import type { QueryClient } from '@tanstack/react-query';

import { loadPinnedHelpArticles } from '../graphql/help-center.ts';

// 共通レイアウトの区画の部品が読む取得を始めて待つ。失敗は区画の中で示すため例外にしない
export type SiteLayoutLoader = (queryClient: QueryClient) => Promise<void>;

// 区画の部品はルートのloaderの結果を読めないエラーと404の画面にも描かれるため、取得のキャッシュから読む。
// ここに登録した取得はルートのloaderが子のルートのloaderと並行に待ち、サーバーの描画に含める
export const SITE_LAYOUT_LOADERS: readonly SiteLayoutLoader[] = Object.freeze([
  loadPinnedHelpArticles,
]);

export async function loadSiteLayout(
  queryClient: QueryClient,
  loaders: readonly SiteLayoutLoader[] = SITE_LAYOUT_LOADERS,
): Promise<void> {
  await Promise.all(loaders.map((load) => load(queryClient)));
}
