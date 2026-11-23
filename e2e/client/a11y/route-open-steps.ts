import { expect, type Page, type Response } from '@playwright/test';

import type { RouteTarget } from './client-route-cases.ts';

const OK_STATUS = 200;

// 画面の取得中に出るスケルトンと読み込み中の領域
const LOADING_SELECTOR = '[data-slot="skeleton"], [aria-busy="true"]';

const SETTLE_TIMEOUT_MS = 30_000;

// ログインへの移動やエラーの画面への差し替えで、検査したい状態と別の画面を検査して通らないよう、状態コードと移動先を確かめる
export function expectOpenedRoute(
  page: Page,
  response: Response | null,
  { url, expectedStatus = OK_STATUS }: RouteTarget,
): void {
  expect(response?.status(), `${url}の応答の状態コード`).toBe(expectedStatus);
  expect(new URL(page.url()).pathname, `${url}を開いた後の移動先`).toBe(
    new URL(url, page.url()).pathname,
  );
}

// スケルトンと読み込み中の領域が全て消えてから検査する
export async function expectSettled(page: Page): Promise<void> {
  await expect(page.locator(LOADING_SELECTOR)).toHaveCount(0, {
    timeout: SETTLE_TIMEOUT_MS,
  });
}
