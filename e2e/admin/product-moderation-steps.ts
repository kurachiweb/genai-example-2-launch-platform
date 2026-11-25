import { expect, type Locator, type Page } from '@playwright/test';

import {
  hideProductDialogCopy,
  MODERATION_PAGE_COPY,
  MODERATION_REASON_LABEL,
  PRODUCT_ACTION_LABELS,
  PRODUCT_DETAIL_COPY,
  PRODUCT_FILTER_LABELS,
  PRODUCT_LIST_CAPTION,
  PRODUCT_VISIBILITY_LABELS,
  unhideProductDialogCopy,
} from '../../apps/admin/src/components/moderation/shared/moderation-messages.ts';
import { APPLY_FILTER_LABEL } from '../../apps/frontend-lib/utilities/messages/admin-console-messages.ts';
import { productPagePath } from '../client/directory-steps.ts';
import {
  type AdminProfileInput,
  openFromAdminNavigation,
} from '../support/admin-bootstrap.ts';
import {
  type MailpitMessage,
  waitForEmailWithSubject,
} from '../support/mailpit.ts';
import { confirmModeration } from './user-moderation-steps.ts';

export interface ModeratedProduct {
  readonly handle: string;
  readonly name: string;
}

type ProductVisibilityOperation = 'product.hide' | 'product.unhide';

const PRODUCTS_PATH = '/products';

const OK_STATUS = 200;

// 措置の通知は確定の後に依頼のQueueを経てイベントサーバーが送る
const MODERATION_NOTICE_TIMEOUT_MS = 60_000;

// 件名はイベントサーバーのメールのテンプレート(ugc-moderation/product-hidden-template.ts)が決める
const PRODUCT_HIDDEN_SUBJECT = 'プロダクトの公開が停止されました';

const PRODUCT_VISIBILITY_ACTIONS = Object.freeze({
  'product.hide': Object.freeze({
    kind: 'hide',
    copyOf: hideProductDialogCopy,
  }),
  'product.unhide': Object.freeze({
    kind: 'unhide',
    copyOf: unhideProductDialogCopy,
  }),
} as const);

const visibilitySectionOf = (page: Page): Locator =>
  page.getByRole('region', {
    name: PRODUCT_DETAIL_COPY.sections.visibility,
    exact: true,
  });

// 管理メニューからプロダクトの一覧を開き、ハンドルで絞り込んだ行の名称のリンクから詳細を開く
export async function openAdminProductDetail(
  page: Page,
  admin: Pick<AdminProfileInput, 'nickname'>,
  product: ModeratedProduct,
): Promise<void> {
  await openFromAdminNavigation(page, admin, PRODUCTS_PATH);
  await expect(
    page.getByRole('heading', {
      level: 1,
      name: MODERATION_PAGE_COPY.products.title,
    }),
  ).toBeVisible();
  await page
    .getByLabel(PRODUCT_FILTER_LABELS.handle, { exact: true })
    .fill(product.handle);
  await page.getByRole('button', { name: APPLY_FILTER_LABEL }).click();
  await expect(page).toHaveURL(
    (url) => url.searchParams.get('handle') === product.handle,
  );
  await page
    .getByRole('table', { name: PRODUCT_LIST_CAPTION, exact: true })
    .getByRole('link', { name: product.name, exact: true })
    .click();
  await expect(
    page.getByRole('heading', { level: 1, name: product.name, exact: true }),
  ).toBeVisible();
  await expect(visibilitySectionOf(page)).toBeVisible();
}

export async function moderateProductVisibility(
  page: Page,
  operation: ProductVisibilityOperation,
  productName: string,
  reason: string,
): Promise<void> {
  const { kind, copyOf } = PRODUCT_VISIBILITY_ACTIONS[operation];
  await confirmModeration(
    page,
    visibilitySectionOf(page).getByRole('button', {
      name: PRODUCT_ACTION_LABELS[kind],
      exact: true,
    }),
    operation,
    copyOf(productName),
    reason,
  );
}

export async function expectHiddenProductDetail(
  page: Page,
  reason: string,
): Promise<void> {
  const section = visibilitySectionOf(page);
  await expect(
    section.getByText(PRODUCT_VISIBILITY_LABELS.hidden, { exact: true }),
  ).toBeVisible();
  await expect(
    section
      .getByRole('term')
      .filter({ hasText: MODERATION_REASON_LABEL })
      .locator('xpath=following-sibling::dd[1]'),
  ).toHaveText(reason);
  await expect(
    section.getByRole('button', {
      name: PRODUCT_ACTION_LABELS.unhide,
      exact: true,
    }),
  ).toBeVisible();
}

export async function expectVisibleProductDetail(page: Page): Promise<void> {
  const section = visibilitySectionOf(page);
  await expect(
    section.getByText(PRODUCT_VISIBILITY_LABELS.visible, { exact: true }),
  ).toBeVisible();
  await expect(
    section.getByRole('button', {
      name: PRODUCT_ACTION_LABELS.hide,
      exact: true,
    }),
  ).toBeVisible();
}

// 投稿者以外(未ログイン)の利用者側の詳細ページが、公開中のプロダクトとして表示されることを確かめる
export async function expectPublicProductPage(
  page: Page,
  product: ModeratedProduct,
): Promise<void> {
  const response = await page.goto(productPagePath(product.handle));
  expect(response?.status()).toBe(OK_STATUS);
  await expect(
    page.getByRole('heading', { level: 1, name: product.name, exact: true }),
  ).toBeVisible();
}

// 非公開化の通知が投稿者へ届き、本文にプロダクトの名称と入力した理由があることを確かめる
export async function expectProductHiddenNotice(
  email: string,
  product: Pick<ModeratedProduct, 'name'>,
  reason: string,
  receivedAfter: Date,
): Promise<MailpitMessage> {
  const mail = await waitForEmailWithSubject(
    { to: email, subject: PRODUCT_HIDDEN_SUBJECT, receivedAfter },
    { timeoutMs: MODERATION_NOTICE_TIMEOUT_MS },
  );
  expect(mail.text).toContain(product.name);
  expect(mail.text).toContain(reason);
  return mail;
}
