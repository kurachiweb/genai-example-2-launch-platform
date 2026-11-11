import { expect, type Locator, type Page } from '@playwright/test';

import { DIRECTORY_HREF } from '../../apps/client/src/components/layout/site-links.ts';
import { REACTION_TIMEOUT_MS } from '../support/hydration-retry.ts';

export interface DirectorySearchWaitOptions {
  readonly timeoutMs?: number;
}

// 確定のイベントから予選の結果の記録・掲載の記録・索引の更新までにQueueを2回経るため、Queueのまとめの待ちと開発サーバーの初回の変換の遅れを含めて待つ
export const DIRECTORY_INDEX_TIMEOUT_MS = 90_000;

const DIRECTORY_INDEX_POLL_INTERVAL_MS = 2_000;

// ルーターはJSONとして読めない文字列のクエリをそのまま書き出すため、名称のような語はエンコードだけで同じURLになる
export const directorySearchPath = (term: string): string =>
  `${DIRECTORY_HREF}?${new URLSearchParams({ q: term }).toString()}`;

export const directoryItemOf = (page: Page, productName: string): Locator =>
  page.getByRole('article', { name: productName, exact: true });

// 索引は非同期に作られるため、名称で検索したディレクトリを読み込み直し、勝ったプロダクトの項目が現れるまで待つ
export async function waitForDirectorySearchResult(
  page: Page,
  productName: string,
  { timeoutMs = DIRECTORY_INDEX_TIMEOUT_MS }: DirectorySearchWaitOptions = {},
): Promise<Locator> {
  const item = directoryItemOf(page, productName);
  await expect(
    async () => {
      await page.goto(directorySearchPath(productName));
      await expect(item).toBeVisible({ timeout: REACTION_TIMEOUT_MS });
    },
    `ディレクトリの検索に「${productName}」が${String(timeoutMs / 1000)}秒以内に現れません。APIサーバーの23:40の確定のジョブと、イベントサーバーの予選の結果の記録・掲載の記録・索引の更新の処理のログを確かめてください`,
  ).toPass({
    intervals: [DIRECTORY_INDEX_POLL_INTERVAL_MS],
    timeout: timeoutMs,
  });
  return item;
}
