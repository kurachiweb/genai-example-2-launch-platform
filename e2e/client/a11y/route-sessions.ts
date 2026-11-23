import type { Browser, BrowserContext, Page } from '@playwright/test';

import { assumeDistinctClientIp } from '../../support/client-ip.ts';
import { resolveE2ETargets } from '../../support/targets.ts';

export type StorageState = Awaited<ReturnType<BrowserContext['storageState']>>;

export type SessionTarget = 'client' | 'admin';

export const baseURLOf = (target: SessionTarget): string => {
  const found = resolveE2ETargets(process.env).find(
    ({ name }) => name === target,
  );
  if (found === undefined) {
    throw new Error(`E2E対象${target}が定義されていません`);
  }
  return found.baseURL;
};

// 利用者側の回数制限に当たらないよう、文脈ごとに別の接続元を名乗る
export async function openSessionContext(
  browser: Browser,
  target: SessionTarget,
  storageState?: StorageState,
): Promise<BrowserContext> {
  const baseURL = baseURLOf(target);
  const context = await browser.newContext({
    baseURL,
    ...(storageState === undefined ? {} : { storageState }),
  });
  await assumeDistinctClientIp(context, baseURL);
  return context;
}

// 文脈を開いてページを渡し、終わったら必ず閉じる。結果の値にはログイン後のセッションを含められる
export async function withSessionPage<T>(
  browser: Browser,
  target: SessionTarget,
  use: (page: Page, context: BrowserContext) => Promise<T>,
  storageState?: StorageState,
): Promise<T> {
  const context = await openSessionContext(browser, target, storageState);
  try {
    return await use(await context.newPage(), context);
  } finally {
    await context.close();
  }
}
