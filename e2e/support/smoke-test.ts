import { test as base } from '@playwright/test';

import {
  createStaticFileCache,
  isStaticFileUrl,
  rememberStaticFile,
  replayStaticFile,
  type StaticFileCache,
} from './static-file-cache.ts';

export { expect } from '@playwright/test';

interface SmokeWorkerFixtures {
  readonly staticFileCache: StaticFileCache;
}

// ブラウザの文脈はテストごとに空のキャッシュで始まり、ページを開くたびに全ての静的なファイルを取り直す。
// デプロイ先のゾーンのレート制限は静的なファイルも含む送信元IPアドレス単位の要求数を数えるため、同じワーカーの中では1度取ったファイルを使い回して要求を減らす
export const test = base.extend<object, SmokeWorkerFixtures>({
  staticFileCache: [
    // eslint-disable-next-line no-empty-pattern -- Playwrightはfixtureの第1引数に分割代入の形を求める
    async ({}, use) => {
      await use(createStaticFileCache());
    },
    { scope: 'worker' },
  ],
  context: async ({ context, staticFileCache }, use) => {
    await context.route(isStaticFileUrl, (route) =>
      replayStaticFile(staticFileCache, route),
    );
    context.on('response', (response) => {
      void rememberStaticFile(staticFileCache, response);
    });
    await use(context);
  },
});
