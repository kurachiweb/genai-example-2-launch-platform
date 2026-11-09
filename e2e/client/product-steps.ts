import { randomBytes } from 'node:crypto';

import { expect, type Locator, type Page } from '@playwright/test';

import { PRODUCT_CATEGORY_OTHER_NAME } from '../../apps/common-lib/product/product-category-constants.ts';
import {
  UNLISTED_PRODUCT_BADGE,
  UNLISTED_PRODUCTS_NOTICE,
} from '../../apps/client/src/components/launch-history/launch-history-messages.ts';
import {
  businessDateOf,
  kickoffAtOf,
} from '../../apps/client/src/components/product/business-time.ts';
import { LAUNCH_STATUS_LABELS } from '../../apps/client/src/components/product/launch-messages.ts';
import {
  editProductLabel,
  MY_PRODUCTS_PAGE_TITLE,
  productLogoAlt,
} from '../../apps/client/src/components/product/my-product-messages.ts';
import {
  DELETE_CONFIRM_LABEL,
  DELETE_PRODUCT_LABEL,
  deleteConfirmTitleOf,
  PRODUCT_DELETED_MESSAGE,
  PRODUCT_SAVED_MESSAGE,
} from '../../apps/client/src/components/product/product-edit-messages.ts';
import {
  BASIC_SECTION_HEADING,
  CATEGORY_FIELD_LABEL,
  DESCRIPTION_FIELD_LABEL,
  EDIT_SUBMIT_LABEL,
  LAUNCH_DATE_FIELD_LABEL,
  NAME_FIELD_LABEL,
  PRODUCT_HANDLE_FIELD_LABEL,
  PRODUCT_REGISTER_PAGE_TITLE,
  REGISTER_SUBMIT_LABEL,
  SCREENSHOTS_SECTION_HEADING,
  screenshotRemoveLabelOf,
  TAGLINE_FIELD_LABEL,
  WEBSITE_URL_FIELD_LABEL,
} from '../../apps/client/src/components/product/product-form-messages.ts';
import { waitForBotToken } from '../support/bot-verification.ts';
import { uploadCroppedImage } from '../support/image-upload.ts';
import { MAIL_FLOW_TIMEOUT_MS } from './auth/account-steps.ts';
import {
  expectMarkdownLink,
  fillMarkdownWithLink,
  type MarkdownLink,
} from './markdown-steps.ts';

// 登録・メールの確認に加え、画像の送信・3回の保存・公開プロフィールの表示・削除を1つの流れで行うため、メールの流れの待ちの2倍にする
export const PRODUCT_FLOW_TIMEOUT_MS = MAIL_FLOW_TIMEOUT_MS * 2;

const MY_PRODUCTS_PATH = '/my/products';

const PRODUCT_REGISTRATION_PATH = '/my/products/new';

const LOGO_FILE_NAME = 'e2e-product-logo.png';

const SCREENSHOT_FILE_NAME = 'e2e-product-screenshot.png';

const SCREENSHOT_SIZE_PX = 320;

// カレンダーの部品の日本語の表記の「次の月へ」のボタン
const NEXT_MONTH_LABEL = '次の月へ';

const MAX_MONTH_MOVES = 3;

// 当日の選べる日の締め切り(業務時刻の23:40)を過ぎても選べ、前日の23:45からの変更の固定にも掛からないよう、業務日付の今日から日数を空ける
const REGISTERED_LAUNCH_OFFSET_DAYS = 3;

const CHANGED_LAUNCH_OFFSET_DAYS = 5;

const MILLISECONDS_PER_DAY = 86_400_000;

const REGISTERED_MESSAGE_PATTERN = /^プロダクトを登録しました。/u;

export interface ProductInput {
  readonly name: string;
  readonly tagline: string;
  readonly handle: string;
  readonly websiteUrl: string;
  readonly descriptionText: string;
  readonly descriptionLink: MarkdownLink;
  readonly categoryName: string;
}

// 前の実行のデータと衝突せず、予約語にも当たらないよう、乱数から作る
export function createProductHandle(): string {
  return `e2e-product-${randomBytes(4).toString('hex')}`;
}

export function createProductInput(): ProductInput {
  const suffix = randomBytes(4).toString('hex');
  return {
    name: `E2Eプロダクト${suffix}`,
    tagline: `E2Eのタグライン${suffix}`,
    handle: createProductHandle(),
    websiteUrl: `https://product-${suffix}.example/`,
    descriptionText: `E2Eの説明文${suffix}です。`,
    descriptionLink: {
      text: `E2Eの説明文のリンク${suffix}`,
      url: `https://docs-${suffix}.example/guide`,
    },
    categoryName: PRODUCT_CATEGORY_OTHER_NAME,
  };
}

const addDays = (businessDate: string, days: number): string =>
  new Date(
    Date.parse(`${businessDate}T00:00:00.000Z`) + days * MILLISECONDS_PER_DAY,
  )
    .toISOString()
    .slice(0, 10);

// 登録のローンチ日と、変更の後のローンチ日(業務日付)
export function upcomingLaunchDates(): readonly [string, string] {
  const today = businessDateOf(new Date());
  return [
    addDays(today, REGISTERED_LAUNCH_OFFSET_DAYS),
    addDays(today, CHANGED_LAUNCH_OFFSET_DAYS),
  ];
}

// カレンダーの日のボタンは、業務日付と同じ暦日を日本語の完全な日付の表記で読み上げる
const dayLabelOf = (businessDate: string): string =>
  new Intl.DateTimeFormat('ja-JP', {
    dateStyle: 'full',
    timeZone: 'UTC',
  }).format(new Date(`${businessDate}T00:00:00.000Z`));

const selectedDayLabelOf = (businessDate: string): string =>
  `${dayLabelOf(businessDate)}、選択済み`;

const kickoffTimeOf = (scope: Locator, launchDate: string): Locator =>
  scope.locator(`time[datetime="${kickoffAtOf(launchDate)}"]`);

const launchDateTimeOf = (scope: Locator, launchDate: string): Locator =>
  scope.locator(`time[datetime="${launchDate}"]`);

export const myProductEditPath = (handle: string): string =>
  `${MY_PRODUCTS_PATH}/${handle}/edit`;

export const productArticle = (page: Page, name: string): Locator =>
  page.getByRole('article', { name, exact: true });

const field = (form: Locator, label: string): Locator =>
  form.getByLabel(label, { exact: true });

const launchDateGroup = (form: Locator): Locator =>
  form.getByRole('group', { name: LAUNCH_DATE_FIELD_LABEL, exact: true });

// フォームの入力はハイドレーションの後でなければ状態に入らないため、ハイドレーションの後に描かれるbot判定のウィジェットのトークンを待つ
export async function openProductRegistration(page: Page): Promise<Locator> {
  await page.goto(PRODUCT_REGISTRATION_PATH);
  const form = page.getByRole('form', { name: PRODUCT_REGISTER_PAGE_TITLE });
  await waitForBotToken(form);
  return form;
}

export async function openMyProducts(page: Page): Promise<void> {
  await page.goto(MY_PRODUCTS_PATH);
  await expect(
    page.getByRole('heading', { level: 1, name: MY_PRODUCTS_PAGE_TITLE }),
  ).toBeVisible();
}

// 保存の結果を画面の取得のキャッシュではなくサーバーから読むよう、一覧を開き直してから編集の導線で移る
export async function openProductEditor(
  page: Page,
  name: string,
): Promise<Locator> {
  await openMyProducts(page);
  await productArticle(page, name)
    .getByRole('link', { name: editProductLabel(name), exact: true })
    .click();
  const form = page.getByRole('form', { name: editProductLabel(name) });
  await waitForBotToken(form);
  return form;
}

async function chooseCategory(
  page: Page,
  form: Locator,
  categoryName: string,
): Promise<void> {
  await form
    .getByRole('combobox', { name: CATEGORY_FIELD_LABEL, exact: true })
    .click();
  await page.getByRole('option', { name: categoryName, exact: true }).click();
}

// 選べる日のカレンダーは選んだ日か最も早い選べる日の月から描くため、選ぶ日の月まで次の月へ進める
export async function chooseLaunchDate(
  form: Locator,
  launchDate: string,
): Promise<void> {
  const group = launchDateGroup(form);
  const day = group.getByRole('button', {
    name: dayLabelOf(launchDate),
    exact: true,
  });
  for (let moves = 0; moves < MAX_MONTH_MOVES; moves += 1) {
    if (await day.isVisible()) {
      break;
    }
    await group.getByRole('button', { name: NEXT_MONTH_LABEL }).click();
  }
  await expect(day).not.toHaveAttribute('aria-disabled', 'true');
  await day.click();
  await expect(
    group.getByRole('button', {
      name: selectedDayLabelOf(launchDate),
      exact: true,
    }),
  ).toBeVisible();
}

export async function fillProductHandle(
  form: Locator,
  handle: string,
): Promise<void> {
  await field(form, PRODUCT_HANDLE_FIELD_LABEL).fill(handle);
}

// 説明文の値は入力欄からフォーカスが外れた時に確定するため、続けて外部WebサイトURLの欄へ入力する
export async function fillProduct(
  page: Page,
  form: Locator,
  input: ProductInput,
  launchDate: string,
): Promise<void> {
  await uploadCroppedImage(
    page,
    form.getByRole('region', { name: BASIC_SECTION_HEADING, exact: true }),
    { fileName: LOGO_FILE_NAME },
  );
  await field(form, NAME_FIELD_LABEL).fill(input.name);
  await field(form, TAGLINE_FIELD_LABEL).fill(input.tagline);
  await chooseCategory(page, form, input.categoryName);
  await fillProductHandle(form, input.handle);
  await fillMarkdownWithLink(
    page,
    form,
    DESCRIPTION_FIELD_LABEL,
    input.descriptionText,
    input.descriptionLink,
  );
  await field(form, WEBSITE_URL_FIELD_LABEL).fill(input.websiteUrl);
  await uploadCroppedImage(
    page,
    form.getByRole('region', {
      name: SCREENSHOTS_SECTION_HEADING,
      exact: true,
    }),
    { fileName: SCREENSHOT_FILE_NAME, sizePx: SCREENSHOT_SIZE_PX },
  );
  await expect(
    form.getByRole('button', { name: screenshotRemoveLabelOf(1), exact: true }),
  ).toBeVisible();
  await chooseLaunchDate(form, launchDate);
}

// 登録に成功すると、キックオフの日時のトーストを示して自分のプロダクトの一覧へ移る
export async function registerProduct(
  page: Page,
  form: Locator,
): Promise<void> {
  await form
    .getByRole('button', { name: REGISTER_SUBMIT_LABEL, exact: true })
    .click();
  await expect(page.getByText(REGISTERED_MESSAGE_PATTERN)).toBeVisible();
  await expect(page).toHaveURL((url) => url.pathname === MY_PRODUCTS_PATH);
}

// 続けての保存の成功を前の保存のトーストと取り違えないよう、前のトーストが消えてから送る
export async function saveProductChanges(
  page: Page,
  form: Locator,
): Promise<void> {
  const savedToast = page.getByText(PRODUCT_SAVED_MESSAGE);
  await expect(savedToast).toHaveCount(0);
  await form
    .getByRole('button', { name: EDIT_SUBMIT_LABEL, exact: true })
    .click();
  await expect(savedToast).toBeVisible();
}

export async function expectMyProductCard(
  page: Page,
  input: Pick<ProductInput, 'name' | 'handle'>,
  launchDate: string,
): Promise<void> {
  await openMyProducts(page);
  const card = productArticle(page, input.name);
  await expect(card.getByText(input.handle, { exact: true })).toBeVisible();
  await expect(
    card.getByText(LAUNCH_STATUS_LABELS.scheduled, { exact: true }),
  ).toBeVisible();
  await expect(kickoffTimeOf(card, launchDate)).toBeVisible();
}

// 編集画面に、登録で入力したロゴ・スクリーンショット・リンクを含む説明文・ハンドル・ローンチ日が読み込まれる
export async function expectSavedProduct(
  form: Locator,
  input: ProductInput,
  launchDate: string,
): Promise<void> {
  await expect(
    form.getByRole('img', { name: productLogoAlt(input.name), exact: true }),
  ).toBeVisible();
  await expect(
    form.getByRole('button', { name: screenshotRemoveLabelOf(1), exact: true }),
  ).toBeVisible();
  await expectMarkdownLink(
    form,
    DESCRIPTION_FIELD_LABEL,
    input.descriptionLink,
  );
  await expect(field(form, NAME_FIELD_LABEL)).toHaveValue(input.name);
  await expect(field(form, PRODUCT_HANDLE_FIELD_LABEL)).toHaveValue(
    input.handle,
  );
  await expect(field(form, WEBSITE_URL_FIELD_LABEL)).toHaveValue(
    input.websiteUrl,
  );
  await expect(
    launchDateGroup(form).getByRole('button', {
      name: selectedDayLabelOf(launchDate),
      exact: true,
    }),
  ).toBeVisible();
}

// 公開プロフィールの既定のタブのローンチ履歴に、本人にだけ未掲載のバッジと案内付きで出る
export async function expectLaunchHistoryItem(
  page: Page,
  input: Pick<ProductInput, 'name'>,
  launchDate: string,
): Promise<void> {
  const item = productArticle(page, input.name);
  await expect(item).toBeVisible();
  await expect(
    item.getByText(UNLISTED_PRODUCT_BADGE, { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(UNLISTED_PRODUCTS_NOTICE)).toBeVisible();
  await expect(launchDateTimeOf(item, launchDate)).toBeVisible();
  await expect(kickoffTimeOf(item, launchDate)).toBeVisible();
}

// 削除の確認のダイアログのフォームはダイアログを開いてからbot判定のトークンを発行するため、トークンを待ってから確定する
export async function deleteProduct(
  page: Page,
  form: Locator,
  name: string,
): Promise<void> {
  await expect(form).toBeVisible();
  await page
    .getByRole('button', { name: DELETE_PRODUCT_LABEL, exact: true })
    .click();
  const title = deleteConfirmTitleOf(name);
  const dialog = page.getByRole('dialog', { name: title });
  const confirmForm = dialog.getByRole('form', { name: title });
  await waitForBotToken(confirmForm);
  await confirmForm
    .getByRole('button', { name: DELETE_CONFIRM_LABEL, exact: true })
    .click();
  await expect(page.getByText(PRODUCT_DELETED_MESSAGE)).toBeVisible();
  await expect(page).toHaveURL((url) => url.pathname === MY_PRODUCTS_PATH);
}

// 転送を追わない要求で、サーバーが返す状態と転送先を確かめる
export async function requestWithoutFollowing(
  page: Page,
  path: string,
): Promise<{ status: number; location: string | undefined }> {
  const response = await page.request.get(path, { maxRedirects: 0 });
  return {
    status: response.status(),
    location: response.headers().location,
  };
}
