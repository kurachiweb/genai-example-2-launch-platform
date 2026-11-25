import { randomBytes } from 'node:crypto';

import type { BrowserContext, Page } from '@playwright/test';

import type { ApiKeyScopes } from '../../apps/common-lib/public-api/api-key-rules.ts';
import { assumeDistinctClientIp } from '../support/client-ip.ts';
import { createEndedQualifier } from '../support/directory-fixtures.ts';
import {
  createPublicApiClient,
  type PublicApiClient,
} from '../support/public-api.ts';
import { triggerScheduled } from '../support/scheduled-trigger.ts';
import {
  createTestAccount,
  MAIL_FLOW_TIMEOUT_MS,
} from './auth/account-steps.ts';
import { expect, test as base } from './auth/auth-test.ts';
import {
  DIRECTORY_INDEX_TIMEOUT_MS,
  waitForDirectorySearchResult,
} from './directory-steps.ts';
import {
  isNearQualifierFullTime,
  QUALIFIER_FULL_TIME_SKIP_REASON,
} from './match-steps.ts';
import {
  createProductInput,
  fillProduct,
  openProductRegistration,
  PRODUCT_FLOW_TIMEOUT_MS,
  type ProductInput,
  registerProduct,
  upcomingLaunchDates,
} from './product-steps.ts';
import {
  openProfileEditor,
  readCurrentHandle,
  registerVerifiedAccount,
} from './profile-steps.ts';
import {
  createApiKeyName,
  deleteApiKey,
  expectProductDescription,
  type IssuedApiKey,
  issueApiKey,
  openApiKeySettings,
  reissueApiKey,
} from './public-api-steps.ts';

interface UserPageFixtures {
  // 対戦相手とサポーターを用意するため、呼ぶたびに別の接続元を名乗る別のブラウザの文脈で開く。開いた文脈はテストの終わりに閉じる
  readonly openUserPage: () => Promise<Page>;
}

const test = base.extend<UserPageFixtures>({
  openUserPage: async ({ browser, baseURL }, use) => {
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
});

// 2人のプロダクトの登録・サポーターの登録・掲載の待ちに、キーの操作と公開APIの確認の分を足す
test.describe.configure({
  timeout:
    PRODUCT_FLOW_TIMEOUT_MS * 2 +
    MAIL_FLOW_TIMEOUT_MS * 2 +
    DIRECTORY_INDEX_TIMEOUT_MS,
});

const QUALIFIER_FULL_TIME = '23:40';

const OK_STATUS = 200;

const UNAUTHORIZED_STATUS = 401;

const FORBIDDEN_STATUS = 403;

// プロダクトの読み取りと説明文の読み書きだけを許し、プロフィールは許さない
const API_KEY_SCOPES: ApiKeyScopes = Object.freeze({
  products: 'read',
  launches: 'none',
  upvotes: 'none',
  comments: 'none',
  ratings: 'none',
  profile: 'none',
  productDescriptions: 'read_write',
});

// ローンチ日は画面で選べる日に登録し、予選の補助が当日へ書き換える
async function registerOwnerProduct(page: Page): Promise<ProductInput> {
  await registerVerifiedAccount(page, createTestAccount());
  const input = createProductInput();
  const [launchDate] = upcomingLaunchDates();
  const form = await openProductRegistration(page);
  await fillProduct(page, form, input, launchDate);
  await registerProduct(page, form);
  return input;
}

async function registerSupporterHandle(page: Page): Promise<string> {
  const account = createTestAccount();
  await registerVerifiedAccount(page, account);
  return readCurrentHandle(await openProfileEditor(page, account));
}

const productPath = (handle: string): string => `/products/${handle}`;

async function expectProductReadable(
  api: PublicApiClient,
  key: IssuedApiKey,
  handle: string,
): Promise<void> {
  const response = await api.request({
    apiKey: key.plainKey,
    path: productPath(handle),
  });
  expect(response.status, `キー(${key.createdAt})での詳細の取得`).toBe(
    OK_STATUS,
  );
  expect(response.body).toMatchObject({ data: { handle } });
}

test.describe('公開APIとAPIキー', () => {
  test('設定ページで発行したキーで掲載中の自分のプロダクトの詳細を読めて、権限の無いプロフィールは403になり、説明文を更新すると詳細ページの説明文が変わり、再発行すると元と新しいキーの両方で読めて、元のキーを削除すると元のキーは401・新しいキーは200になる', async ({
    page,
    openUserPage,
  }) => {
    test.skip(
      isNearQualifierFullTime(new Date()),
      QUALIFIER_FULL_TIME_SKIP_REASON,
    );
    const ownerPage = page;
    const opponentPage = await openUserPage();
    const supporterPage = await openUserPage();
    const owned = await registerOwnerProduct(ownerPage);
    const opponent = await registerOwnerProduct(opponentPage);
    const supporterHandle = await registerSupporterHandle(supporterPage);

    const { businessDate } = await createEndedQualifier({
      winnerHandle: owned.handle,
      loserHandle: opponent.handle,
      supporterHandle,
    });
    await triggerScheduled({
      worker: 'api',
      businessDate,
      businessTime: QUALIFIER_FULL_TIME,
    });
    await waitForDirectorySearchResult(supporterPage, owned.name);

    await openApiKeySettings(ownerPage);
    const original = await issueApiKey(
      ownerPage,
      createApiKeyName(),
      API_KEY_SCOPES,
    );
    const api = createPublicApiClient();

    await expectProductReadable(api, original, owned.handle);

    const profile = await api.request({
      apiKey: original.plainKey,
      path: '/me/profile',
    });
    expect(profile.status).toBe(FORBIDDEN_STATUS);
    expect(profile.body).toMatchObject({
      error: { code: 'insufficient_scope' },
    });

    const descriptionText = `E2Eの公開APIで更新した説明文${randomBytes(4).toString('hex')}です。`;
    const updated = await api.request({
      apiKey: original.plainKey,
      method: 'PUT',
      path: `/me/products/${owned.handle}/description`,
      body: { description_markdown: descriptionText },
    });
    expect(updated.status).toBe(OK_STATUS);
    expect(updated.body).toMatchObject({
      data: { handle: owned.handle, description_markdown: descriptionText },
    });
    await expectProductDescription(ownerPage, owned.handle, descriptionText);

    await openApiKeySettings(ownerPage);
    const reissued = await reissueApiKey(ownerPage, original);
    expect(reissued.plainKey).not.toBe(original.plainKey);
    await expectProductReadable(api, original, owned.handle);
    await expectProductReadable(api, reissued, owned.handle);

    await deleteApiKey(ownerPage, original);
    const revoked = await api.request({
      apiKey: original.plainKey,
      path: productPath(owned.handle),
    });
    expect(revoked.status).toBe(UNAUTHORIZED_STATUS);
    expect(revoked.body).toMatchObject({ error: { code: 'invalid_api_key' } });
    await expectProductReadable(api, reissued, owned.handle);
  });
});
