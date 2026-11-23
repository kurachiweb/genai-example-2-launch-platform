import { randomBytes } from 'node:crypto';

import { expect, type Browser, type Page } from '@playwright/test';

import {
  BOLD_ACTION_LABEL,
  FORMAT_TOOLBAR_LABEL,
} from '../../../apps/frontend-lib/utilities/messages/markdown-messages.ts';
import { PRODUCT_CATEGORIES_TITLE } from '../../../apps/admin/src/components/product/product-category-messages.ts';
import { HELP_CATEGORIES_TITLE } from '../../../apps/admin/src/components/help/help-messages.ts';
import type { ApiKeyScopes } from '../../../apps/common-lib/public-api/api-key-rules.ts';
import { CATEGORIES_PATH, createCategory } from '../../admin/category-steps.ts';
import {
  createHelpArticle,
  createHelpHandle,
  deleteHelpArticle,
  helpArticleEditPath,
  type HelpArticleInput,
} from '../../admin/help-center-steps.ts';
import {
  openFromAdminNavigation,
  signInAsNewAdmin,
} from '../../support/admin-bootstrap.ts';
import { createTestAccount, type TestAccount } from '../auth/account-steps.ts';
import {
  exportItems,
  openDataExportFromSettingsNavigation,
  requestDataExport,
} from '../data-export-steps.ts';
import { followFromProfile } from '../follow-steps.ts';
import { submitMemberInquiry, uniqueText } from '../inquiry/inquiry-steps.ts';
import {
  isNearQualifierFullTime,
  moveLaunchesToDate,
  startQualifiers,
  todayBusinessDate,
} from '../match-steps.ts';
import {
  fillProduct,
  openProductRegistration,
  registerProduct,
  upcomingLaunchDates,
  createProductInput,
} from '../product-steps.ts';
import {
  createProfileInput,
  fillProfile,
  openProfileEditor,
  profilePath,
  registerVerifiedAccount,
  saveProfile,
} from '../profile-steps.ts';
import {
  createApiKeyName,
  issueApiKey,
  openApiKeySettings,
} from '../public-api-steps.ts';
import { worldCache } from '../../support/route-world-cache.ts';
import {
  type StorageState,
  withSessionPage,
} from '../../support/route-sessions.ts';

const { cachedWorld, peekWorld } = worldCache('client');

export interface HelpArticleRecord {
  readonly id: string;
  readonly title: string;
  readonly handle: string;
}

export interface AdminWorld {
  readonly productCategory: string;
  readonly helpCategory: string;
  readonly storageState: StorageState;
  readonly helpArticles: readonly HelpArticleRecord[];
}

export interface UserWorld {
  readonly account: TestAccount;
  readonly storageState: StorageState;
  readonly handle: string;
  readonly productName: string;
  readonly productHandle: string;
}

export interface MemberWorld extends UserWorld {
  readonly inquiryPath: string;
}

export interface EmptyUserWorld {
  readonly account: TestAccount;
  readonly storageState: StorageState;
}

const HELP_ARTICLE_COUNT = 2;

const EDITOR_WARM_UP_TIMEOUT_MS = 120_000;

const EXPORT_LIST_TIMEOUT_MS = 30_000;

const HELP_ARTICLE_NEW_PATH = '/help-articles/new';

const BROWSE_ONLY_API_KEY_SCOPES: ApiKeyScopes = Object.freeze({
  products: 'read',
  launches: 'none',
  upvotes: 'none',
  comments: 'none',
  ratings: 'none',
  profile: 'none',
  productDescriptions: 'none',
});

const helpArticleInput = (
  categoryName: string,
  label: string,
): HelpArticleInput => ({
  title: uniqueText(`監査のヘルプ記事${label}`),
  subtitle: `監査のための記事${label}のサブタイトル`,
  handle: createHelpHandle(label),
  categoryName,
  pinned: false,
  status: 'published',
  body: [
    { kind: 'heading', text: `見出し${label}` },
    { kind: 'paragraph', text: `監査のための記事${label}の本文です。` },
  ],
});

// 開発サーバーは初めて開く画面の部品の変換に時間が掛かり、上流の記事の作成の手順の待ち(既定の5秒)を超えるため、書式のツールが使えるまで先に長く待つ
async function warmUpHelpArticleEditor(
  page: Page,
  path: string,
): Promise<void> {
  await page.goto(path);
  await expect(
    page
      .getByRole('toolbar', { name: FORMAT_TOOLBAR_LABEL })
      .getByRole('button', { name: BOLD_ACTION_LABEL, exact: true }),
  ).toBeEnabled({ timeout: EDITOR_WARM_UP_TIMEOUT_MS });
}

async function createHelpArticles(
  page: Page,
  categoryName: string,
): Promise<readonly HelpArticleRecord[]> {
  const records: HelpArticleRecord[] = [];
  for (const label of ['a', 'b'].slice(0, HELP_ARTICLE_COUNT)) {
    const input = helpArticleInput(categoryName, label);
    records.push({
      id: await createHelpArticle(page, input),
      title: input.title,
      handle: input.handle,
    });
  }
  return records;
}

// 商品のカテゴリは予選のマッチを専用のカテゴリの中だけで組むため、ヘルプのカテゴリは記事を他の確認の並びと混ぜないために、実行ごとに作る
export const adminWorld = (browser: Browser): Promise<AdminWorld> =>
  cachedWorld('admin', () =>
    withSessionPage(browser, 'admin', async (page, context) => {
      const admin = await signInAsNewAdmin(page, { role: 'moderator' });
      await openFromAdminNavigation(page, admin, CATEGORIES_PATH);
      const suffix = randomBytes(6).toString('hex');
      const productCategory = `E2E監査のカテゴリ${suffix}`;
      const helpCategory = `E2E監査のヘルプ${suffix}`;
      await createCategory(page, PRODUCT_CATEGORIES_TITLE, {
        name: productCategory,
        handle: `e2e-a11y-${suffix}`,
      });
      await createCategory(page, HELP_CATEGORIES_TITLE, { name: helpCategory });
      await warmUpHelpArticleEditor(page, HELP_ARTICLE_NEW_PATH);
      const helpArticles = await createHelpArticles(page, helpCategory);
      return {
        productCategory,
        helpCategory,
        storageState: await context.storageState(),
        helpArticles,
      };
    }),
  );

// 消した記事を開き直して失敗しないよう、後始末は用意の1回につき1度だけ行う
export async function deleteWorldHelpArticles(browser: Browser): Promise<void> {
  const admin = await peekWorld<AdminWorld>('admin');
  if (admin === undefined) {
    return;
  }
  await cachedWorld('help-articles-cleanup', () =>
    deleteHelpArticlesOf(browser, admin),
  );
}

const deleteHelpArticlesOf = (
  browser: Browser,
  admin: AdminWorld,
): Promise<true> =>
  withSessionPage(
    browser,
    'admin',
    async (page) => {
      for (const { id, title } of admin.helpArticles) {
        await warmUpHelpArticleEditor(page, helpArticleEditPath(id));
        await deleteHelpArticle(page, id, title);
      }
      return true as const;
    },
    admin.storageState,
  );

interface AccountStage {
  readonly account: TestAccount;
  readonly handle: string;
  readonly storageState: StorageState;
}

interface ProductStage {
  readonly productName: string;
  readonly productHandle: string;
}

// 開発サーバーが重い時の一時的な待ちの不足で全体をやり直さずに済むよう、長い用意は段階ごとに残し、失敗した段階だけをやり直す
const accountStage = (browser: Browser, key: string): Promise<AccountStage> =>
  cachedWorld(`${key}-account`, () =>
    withSessionPage(browser, 'client', async (page, context) => {
      const account = createTestAccount();
      await registerVerifiedAccount(page, account);
      const profileForm = await openProfileEditor(page, account);
      const profile = createProfileInput();
      await fillProfile(page, profileForm, profile);
      await saveProfile(page, profileForm);
      return {
        account,
        handle: profile.handle,
        storageState: await context.storageState(),
      };
    }),
  );

const productStage = (
  browser: Browser,
  key: string,
  { storageState }: AccountStage,
  productCategory: string,
): Promise<ProductStage> =>
  cachedWorld(`${key}-product`, () =>
    withSessionPage(
      browser,
      'client',
      async (page) => {
        const product = {
          ...createProductInput(),
          categoryName: productCategory,
        };
        const [launchDate] = upcomingLaunchDates();
        const form = await openProductRegistration(page);
        await fillProduct(page, form, product, launchDate);
        await registerProduct(page, form);
        return { productName: product.name, productHandle: product.handle };
      },
      storageState,
    ),
  );

async function ownerWorld(browser: Browser, key: string): Promise<UserWorld> {
  const admin = await adminWorld(browser);
  const account = await accountStage(browser, key);
  const product = await productStage(
    browser,
    key,
    account,
    admin.productCategory,
  );
  return { ...account, ...product };
}

export const rivalWorld = (browser: Browser): Promise<UserWorld> =>
  ownerWorld(browser, 'rival');

// 要求の受け付けのトーストが閉じるのを待つ上流の手順の待ち(既定の5秒)は、負荷の高い環境でトーストの表示が長引くと外れるため、外れた場合は一覧に要求の項目が現れたことで要求の成功を確かめる
async function requestDataExportTolerantly(page: Page): Promise<void> {
  try {
    await requestDataExport(page);
  } catch {
    await expect(exportItems(page)).not.toHaveCount(0, {
      timeout: EXPORT_LIST_TIMEOUT_MS,
    });
  }
}

// 設定の画面へはヘッダーのユーザーメニューから移る上流の手順を使うため、ヘッダーのある画面から始める
const memberStep = <T>(
  browser: Browser,
  key: string,
  { storageState }: AccountStage,
  step: (page: Page) => Promise<T>,
): Promise<T> =>
  cachedWorld(key, () =>
    withSessionPage(
      browser,
      'client',
      async (page) => {
        await page.goto('/');
        return step(page);
      },
      storageState,
    ),
  );

export async function memberWorld(browser: Browser): Promise<MemberWorld> {
  const rival = await rivalWorld(browser);
  const member = await ownerWorld(browser, 'member');
  await memberStep(browser, 'member-follow', member, async (page) => {
    await page.goto(profilePath(rival.handle));
    await followFromProfile(page, rival.handle);
    return true;
  });
  await memberStep(browser, 'member-api-key', member, async (page) => {
    await openApiKeySettings(page);
    await issueApiKey(page, createApiKeyName(), BROWSE_ONLY_API_KEY_SCOPES);
    return true;
  });
  await memberStep(browser, 'member-export', member, async (page) => {
    await openDataExportFromSettingsNavigation(page, member.account);
    await requestDataExportTolerantly(page);
    return true;
  });
  const inquiryPath = await memberStep(
    browser,
    'member-inquiry',
    member,
    (page) =>
      submitMemberInquiry(page, { body: uniqueText('監査の問い合わせ') }),
  );
  return { ...member, inquiryPath };
}

export const emptyUserWorld = (browser: Browser): Promise<EmptyUserWorld> =>
  cachedWorld('empty-user', () =>
    withSessionPage(browser, 'client', async (page, context) => {
      const account = createTestAccount();
      await registerVerifiedAccount(page, account);
      return { account, storageState: await context.storageState() };
    }),
  );

export interface MatchWorld {
  readonly started: boolean;
}

// 予選のペアリングはカテゴリごとに組むため、2つのプロダクトだけの専用のカテゴリで当日のマッチを開始する。締め切りの直前は開始の途中で受け付けが終わるため開始しない
export const matchWorld = (browser: Browser): Promise<MatchWorld> =>
  cachedWorld('match', async () => {
    const member = await memberWorld(browser);
    const rival = await rivalWorld(browser);
    if (isNearQualifierFullTime(new Date())) {
      return { started: false };
    }
    await moveLaunchesToDate(
      [member.productHandle, rival.productHandle],
      todayBusinessDate(),
    );
    await startQualifiers(todayBusinessDate());
    return { started: true };
  });
