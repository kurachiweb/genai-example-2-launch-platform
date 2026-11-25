import { randomBytes } from 'node:crypto';

import { expect, type Browser, type Page } from '@playwright/test';

import {
  HELP_ARTICLE_NOT_FOUND_MESSAGE,
  HELP_CATEGORIES_TITLE,
} from '../../../apps/admin/src/components/help/help-messages.ts';
import type { AdminRole } from '../../../apps/common-lib/admin/admin-roles.ts';
import type { LegalDocumentKind } from '../../../apps/common-lib/legal/legal-documents.ts';
import { REPORT_CATEGORY_OTHER_NAME } from '../../../apps/common-lib/reporting/report-rules.ts';
import {
  BOLD_ACTION_LABEL,
  FORMAT_TOOLBAR_LABEL,
} from '../../../apps/frontend-lib/utilities/messages/markdown-messages.ts';
import { publishLegalDocument } from '../../client/a11y/legal-publish-steps.ts';
import { worldCache } from '../../support/route-world-cache.ts';
import {
  type StorageState,
  withSessionPage,
} from '../../support/route-sessions.ts';
import { createTestAccount } from '../../client/auth/account-steps.ts';
import {
  createGuestInquiryInput,
  expectGuestInquiryCompleted,
  openContactForm,
  submitGuestInquiry,
} from '../../client/inquiry/inquiry-steps.ts';
import { registerSponsorshipOwner } from '../../client/sponsorship-steps.ts';
import {
  type BootstrappedAdmin,
  openFromAdminNavigation,
  signInAsNewAdmin,
} from '../../support/admin-bootstrap.ts';
import { executeLocalD1 } from '../../support/local-d1.ts';
import { createModerationTargets } from '../../support/moderation-fixtures.ts';
import { createReport } from '../../support/report-fixtures.ts';
import {
  createPaidSponsorship,
  kickOffProduct,
} from '../../support/sponsorship-fixtures.ts';
import { CATEGORIES_PATH, createCategory } from '../category-steps.ts';
import {
  createHelpArticle,
  createHelpHandle,
  deleteHelpArticle,
  helpArticleEditPath,
  type HelpArticleInput,
} from '../help-center-steps.ts';
import { openInquiryFromList } from '../inquiry-steps.ts';
import {
  openAutoQuarantinedAvatar,
  registerAutoQuarantinedAvatar,
} from '../media-moderation-steps.ts';
import { openAdminProductDetail } from '../product-moderation-steps.ts';

export interface AdminSession {
  readonly admin: BootstrappedAdmin;
  readonly storageState: StorageState;
}

export interface HelpArticleRecord {
  readonly id: string;
  readonly title: string;
}

export interface HelpWorld {
  readonly categoryName: string;
  readonly articles: readonly HelpArticleRecord[];
}

export interface OwnerWorld {
  readonly email: string;
  readonly productHandle: string;
  readonly productName: string;
}

const { cachedWorld, peekWorld, forgetWorld } = worldCache('admin');

const KEY_PREFIX = 'admin-routes';

const ARTICLE_LABELS = ['a', 'b'] as const;

const HELP_ARTICLE_NEW_PATH = '/help-articles/new';

// 開発サーバーは初めて開く画面の部品の変換に時間が掛かり、上流の記事の作成の手順の待ち(既定の5秒)を超えるため、書式のツールが使えるまで先に長く待つ
export const EDITOR_READY_TIMEOUT_MS = 120_000;

const EMPTY_LIST_PROBE_TIMEOUT_MS = 10_000;

const AVATAR_TIMEOUT_MS = 120_000;

const worldKey = (name: string): string => `${KEY_PREFIX}-${name}`;

const suffixOf = (): string => randomBytes(6).toString('hex');

// 長い用意を段階ごとのキャッシュで再開できるよう、管理者のログイン済みの文脈から始める。管理メニューの操作の手順のため、ヘッダーのある画面を開いておく
async function withAdminPage<T>(
  browser: Browser,
  { storageState }: AdminSession,
  use: (page: Page) => Promise<T>,
): Promise<T> {
  return withSessionPage(
    browser,
    'admin',
    async (page) => {
      await page.goto('/');
      return use(page);
    },
    storageState,
  );
}

// 閲覧のみ・モデレーター・最上位管理者の3人は、ロールごとの表示の差を見るために別々の管理者として作る
export const adminSession = (
  browser: Browser,
  role: AdminRole,
): Promise<AdminSession> =>
  cachedWorld(worldKey(`session-${role}`), () =>
    withSessionPage(browser, 'admin', async (page, context) => {
      const admin = await signInAsNewAdmin(page, { role });
      return { admin, storageState: await context.storageState() };
    }),
  );

export async function waitForEditorToolbar(page: Page): Promise<void> {
  await expect(
    page
      .getByRole('main')
      .getByRole('toolbar', { name: FORMAT_TOOLBAR_LABEL })
      .getByRole('button', { name: BOLD_ACTION_LABEL, exact: true })
      .first(),
  ).toBeEnabled({ timeout: EDITOR_READY_TIMEOUT_MS });
}

const helpCategoryStage = (browser: Browser): Promise<string> =>
  cachedWorld(worldKey('help-category'), async () => {
    const session = await adminSession(browser, 'moderator');
    return withAdminPage(browser, session, async (page) => {
      await openFromAdminNavigation(page, session.admin, CATEGORIES_PATH);
      const name = `E2E管理者監査のヘルプ${suffixOf()}`;
      await createCategory(page, HELP_CATEGORIES_TITLE, { name });
      return name;
    });
  });

const helpArticleInput = (
  categoryName: string,
  label: string,
): HelpArticleInput => ({
  title: `E2E管理者監査のヘルプ記事${label}${suffixOf()}`,
  subtitle: `管理者側の監査のための記事${label}のサブタイトル`,
  handle: createHelpHandle(label),
  categoryName,
  pinned: true,
  status: 'published',
  body: [
    { kind: 'heading', text: `見出し${label}` },
    { kind: 'paragraph', text: `監査のための記事${label}の本文です。` },
  ],
});

const helpArticleStage = (
  browser: Browser,
  categoryName: string,
  label: string,
): Promise<HelpArticleRecord> =>
  cachedWorld(worldKey(`help-article-${label}`), async () => {
    const session = await adminSession(browser, 'moderator');
    return withAdminPage(browser, session, async (page) => {
      await page.goto(HELP_ARTICLE_NEW_PATH);
      await waitForEditorToolbar(page);
      const input = helpArticleInput(categoryName, label);
      return { id: await createHelpArticle(page, input), title: input.title };
    });
  });

// 記事の並べ替えの画面は、カテゴリ内のピン留めの記事を2件以上持つ状態で確かめる
export async function helpWorld(browser: Browser): Promise<HelpWorld> {
  const categoryName = await helpCategoryStage(browser);
  const articles: HelpArticleRecord[] = [];
  for (const label of ARTICLE_LABELS) {
    articles.push(await helpArticleStage(browser, categoryName, label));
  }
  return { categoryName, articles };
}

// 消した記事が用意済みの状態として使い回されないよう、削除したら記録から消す
export async function deleteHelpWorldArticles(browser: Browser): Promise<void> {
  const session = await peekWorld<AdminSession>(worldKey('session-moderator'));
  if (session === undefined) {
    return;
  }
  for (const label of ARTICLE_LABELS) {
    const key = worldKey(`help-article-${label}`);
    const record = await peekWorld<HelpArticleRecord>(key);
    if (record === undefined) {
      continue;
    }
    await withAdminPage(browser, session, (page) =>
      deleteHelpArticleOnce(page, record),
    );
    await forgetWorld(key);
  }
}

// 用意の失敗のやり直しで同じ記事の後始末が重なっても失敗しないよう、削除済みの記事は飛ばす
async function deleteHelpArticleOnce(
  page: Page,
  { id, title }: HelpArticleRecord,
): Promise<true> {
  await page.goto(helpArticleEditPath(id));
  const deletedNotice = page.getByText(HELP_ARTICLE_NOT_FOUND_MESSAGE);
  const toolbar = page
    .getByRole('main')
    .getByRole('toolbar', { name: FORMAT_TOOLBAR_LABEL });
  await expect(deletedNotice.or(toolbar.first())).toBeVisible({
    timeout: EDITOR_READY_TIMEOUT_MS,
  });
  if (await deletedNotice.isVisible()) {
    return true;
  }
  await waitForEditorToolbar(page);
  await deleteHelpArticle(page, id, title);
  return true;
}

const ownerStage = (browser: Browser): Promise<OwnerWorld> =>
  cachedWorld(worldKey('owner'), () =>
    withSessionPage(browser, 'client', async (page) => {
      const { account, product } = await registerSponsorshipOwner(page);
      return {
        email: account.email,
        productHandle: product.handle,
        productName: product.name,
      };
    }),
  );

export const ownerWorld = ownerStage;

export const sponsorshipWorld = (browser: Browser): Promise<true> =>
  cachedWorld(worldKey('sponsorship'), async () => {
    const owner = await ownerStage(browser);
    const product = await kickOffProduct(owner.productHandle);
    await createPaidSponsorship(product, { tier: 'silver' });
    return true as const;
  });

// 詳細の経路のIDは画面に出ないため、一覧から開いた詳細のURLから読む
export const productPathWorld = (browser: Browser): Promise<string> =>
  cachedWorld(worldKey('product-path'), async () => {
    const owner = await ownerStage(browser);
    const session = await adminSession(browser, 'super_admin');
    return withAdminPage(browser, session, async (page) => {
      await openAdminProductDetail(page, session.admin, {
        handle: owner.productHandle,
        name: owner.productName,
      });
      return new URL(page.url()).pathname;
    });
  });

export interface EngagementWorld {
  readonly productHandle: string;
  readonly commentId: string;
}

export const engagementWorld = (): Promise<EngagementWorld> =>
  cachedWorld(worldKey('engagement'), async () => {
    const targets = await createModerationTargets();
    return {
      productHandle: targets.productHandle,
      commentId: targets.comment.commentId,
    };
  });

export const reportCasePathWorld = (): Promise<string> =>
  cachedWorld(worldKey('report-case'), async () => {
    const { commentId } = await engagementWorld();
    const { caseId } = await createReport({
      target: { kind: 'comment', commentId },
      categoryName: REPORT_CATEGORY_OTHER_NAME,
      reporter: { kind: 'guest', contactEmail: null },
    });
    return `/reports/${encodeURIComponent(caseId)}`;
  });

export const inquiryPathWorld = (browser: Browser): Promise<string> =>
  cachedWorld(worldKey('inquiry-path'), async () => {
    const input = createGuestInquiryInput();
    await withSessionPage(browser, 'client', async (page) => {
      const form = await openContactForm(page);
      await submitGuestInquiry(form, input);
      await expectGuestInquiryCompleted(page);
    });
    const session = await adminSession(browser, 'super_admin');
    return withAdminPage(browser, session, (page) =>
      openInquiryFromList(page, session.admin, input.nickname),
    );
  });

// 画像の判定はイベントサーバーのキューを経て終わるため、隔離された画像が管理画面の一覧に出るまでを用意に含める
export const quarantinedAvatarWorld = (browser: Browser): Promise<true> =>
  cachedWorld(worldKey('avatar'), async () => {
    const owner = await withSessionPage(browser, 'client', (page) =>
      registerAutoQuarantinedAvatar(page, createTestAccount()),
    );
    const session = await adminSession(browser, 'super_admin');
    await withAdminPage(browser, session, async (page) => {
      page.setDefaultTimeout(AVATAR_TIMEOUT_MS);
      await openAutoQuarantinedAvatar(page, owner);
    });
    return true as const;
  });

async function readLatestLegalVersion(
  kind: LegalDocumentKind,
): Promise<number> {
  const rows = await executeLocalD1(
    'SELECT kind, latest_version_number AS latest FROM legal_documents;',
  );
  const row = rows.find((candidate) => String(candidate.kind) === kind);
  return row === undefined ? 0 : Number(row.latest);
}

// 公開済みの版がある種別はそのまま使い、無い種別だけを1度公開する。公開は取り消せないため、検査のために公開する版は1種別につき1つに限る
export const legalWorld = (
  browser: Browser,
  kind: LegalDocumentKind,
): Promise<number> =>
  cachedWorld(worldKey(`legal-${kind}`), async () => {
    const before = await readLatestLegalVersion(kind);
    if (before > 0) {
      return before;
    }
    const session = await adminSession(browser, 'super_admin');
    await withAdminPage(browser, session, (page) =>
      publishLegalDocument(page, kind),
    );
    const after = await readLatestLegalVersion(kind);
    if (after < 1) {
      throw new Error(`${kind}を公開しましたが、公開済みの版を確認できません`);
    }
    return after;
  });

// 他のテストのデータと共有する一覧で0件の表示になる条件を、候補を実際に開いて探す。見つからなければnullを返す
export const firstEmptyListPath = (
  browser: Browser,
  name: string,
  paths: readonly string[],
  message: string,
): Promise<string | null> =>
  cachedWorld(worldKey(`empty-${name}`), async () => {
    const session = await adminSession(browser, 'super_admin');
    return withAdminPage(browser, session, async (page) => {
      for (const path of paths) {
        await page.goto(path);
        const empty = await page
          .getByText(message)
          .waitFor({ timeout: EMPTY_LIST_PROBE_TIMEOUT_MS })
          .then(() => true)
          .catch(() => false);
        if (empty) {
          return path;
        }
      }
      return null;
    });
  });
