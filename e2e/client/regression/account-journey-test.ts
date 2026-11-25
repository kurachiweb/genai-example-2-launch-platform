import type { BrowserContext, Page } from '@playwright/test';

import { assumeDistinctClientIp } from '../../support/client-ip.ts';
import { resolveE2ETargets } from '../../support/targets.ts';
import { test as authTest } from '../auth/auth-test.ts';
import {
  deleteHelpArticlesAndCategory,
  type HelpJourneyRecord,
} from './account-journey-steps.ts';

export { expect } from '../auth/auth-test.ts';

interface AccountJourneyFixtures {
  readonly openAdminPage: () => Promise<Page>;
  // テストが作ったヘルプのカテゴリと記事を控え、テストが途中で失敗しても終わりに削除する
  readonly helpRecord: HelpJourneyRecord;
}

const adminBaseURL = (): string => {
  const admin = resolveE2ETargets(process.env).find(
    ({ name }) => name === 'admin',
  );
  if (admin === undefined) {
    throw new Error('管理者側のE2E対象が定義されていません');
  }
  return admin.baseURL;
};

// 利用者側の確認と管理画面の操作を並べる流れのため、管理者は別の接続元を名乗る別のブラウザの文脈で開く。開いた文脈はテストの終わりに閉じる
export const test = authTest.extend<AccountJourneyFixtures>({
  openAdminPage: async ({ browser }, use) => {
    const contexts: BrowserContext[] = [];
    try {
      await use(async () => {
        const baseURL = adminBaseURL();
        const context = await browser.newContext({ baseURL });
        contexts.push(context);
        await assumeDistinctClientIp(context, baseURL);
        return context.newPage();
      });
    } finally {
      await Promise.all(contexts.map((context) => context.close()));
    }
  },
  helpRecord: async ({ openAdminPage }, use) => {
    const record: HelpJourneyRecord = {
      adminPage: await openAdminPage(),
      categoryName: undefined,
      articles: [],
    };
    try {
      await use(record);
    } finally {
      await deleteHelpArticlesAndCategory(record);
    }
  },
});
