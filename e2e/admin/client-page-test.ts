import type { BrowserContext, Page } from '@playwright/test';

import { assumeDistinctClientIp } from '../support/client-ip.ts';
import { resolveE2ETargets } from '../support/targets.ts';
import { test as adminTest } from './admin-test.ts';

export { expect } from './admin-test.ts';

const clientBaseURL = (): string => {
  const client = resolveE2ETargets(process.env).find(
    ({ name }) => name === 'client',
  );
  if (client === undefined) {
    throw new Error('利用者側のE2E対象が定義されていません');
  }
  return client.baseURL;
};

interface ClientPageFixtures {
  readonly clientPage: Page;
  // 利用者を複数人並べる流れのため、呼ぶたびに別のブラウザの文脈で利用者側のページを開く。開いた文脈はテストの終わりに閉じる
  readonly openClientPage: () => Promise<Page>;
}

// 管理画面の操作と利用者側の操作をまたぐ流れのため、管理者とは別のブラウザの文脈で利用者側を開く。利用者側の回数制限に当たらないよう、利用者側のテストと同じく文脈ごとに別の接続元を名乗る
export const test = adminTest.extend<ClientPageFixtures>({
  openClientPage: async ({ browser }, use) => {
    const baseURL = clientBaseURL();
    const contexts: BrowserContext[] = [];
    try {
      await use(async () => {
        const context = await browser.newContext({ baseURL });
        contexts.push(context);
        await assumeDistinctClientIp(context, baseURL);
        return context.newPage();
      });
    } finally {
      await Promise.all(contexts.map((context) => context.close()));
    }
  },
  clientPage: async ({ openClientPage }, use) => {
    await use(await openClientPage());
  },
});
