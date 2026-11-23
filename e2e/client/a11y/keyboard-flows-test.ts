import type { BrowserContext, Page } from '@playwright/test';

import { assumeDistinctClientIp } from '../../support/client-ip.ts';
import { resolveE2ETargets } from '../../support/targets.ts';
import { test as authTest } from '../auth/auth-test.ts';

export { expect } from '../auth/auth-test.ts';

interface BrowserPageFixtures {
  readonly openAdminPage: () => Promise<Page>;
  readonly openClientPage: () => Promise<Page>;
}

const baseURLOf = (name: 'client' | 'admin'): string => {
  const target = resolveE2ETargets(process.env).find(
    (candidate) => candidate.name === name,
  );
  if (target === undefined) {
    throw new Error(`${name}のE2E対象が定義されていません`);
  }
  return target.baseURL;
};

// 予選の流れは管理者のカテゴリの作成と利用者3人を並べるため、呼ぶたびに別の接続元を名乗る別のブラウザの文脈で開く。開いた文脈はテストの終わりに閉じる
export const test = authTest.extend<BrowserPageFixtures>({
  openAdminPage: async ({ browser }, use) => {
    const contexts: BrowserContext[] = [];
    try {
      await use(async () => {
        const baseURL = baseURLOf('admin');
        const context = await browser.newContext({ baseURL });
        contexts.push(context);
        await assumeDistinctClientIp(context, baseURL);
        return context.newPage();
      });
    } finally {
      await Promise.all(contexts.map((context) => context.close()));
    }
  },
  openClientPage: async ({ browser }, use) => {
    const contexts: BrowserContext[] = [];
    try {
      await use(async () => {
        const baseURL = baseURLOf('client');
        const context = await browser.newContext({ baseURL });
        contexts.push(context);
        await assumeDistinctClientIp(context, baseURL);
        return context.newPage();
      });
    } finally {
      await Promise.all(contexts.map((context) => context.close()));
    }
  },
});
