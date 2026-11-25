import { expect, type Locator, type Page } from '@playwright/test';

import {
  BASIC_SECTION_HEADING,
  CATEGORY_FIELD_LABEL,
  DESCRIPTION_FIELD_LABEL,
  LAUNCH_DATE_FIELD_LABEL,
  NAME_FIELD_LABEL,
  PRODUCT_HANDLE_FIELD_LABEL,
  PRODUCT_REGISTER_PAGE_TITLE,
  REGISTER_SUBMIT_LABEL,
  SCREENSHOTS_SECTION_HEADING,
  screenshotRemoveLabelOf,
  TAGLINE_FIELD_LABEL,
  WEBSITE_URL_FIELD_LABEL,
} from '../../../apps/client/src/components/product/product-form-messages.ts';
import {
  IMAGE_CROP_CONFIRM_LABEL,
  IMAGE_CROP_DIALOG_TITLE,
  IMAGE_CROP_LOADING_MESSAGE,
} from '../../../apps/frontend-lib/utilities/messages/media-crop-messages.ts';
import { UPLOAD_STATUS_UPLOADED } from '../../../apps/frontend-lib/utilities/messages/media-upload-messages.ts';
import {
  BOLD_ACTION_LABEL,
  FORMAT_TOOLBAR_LABEL,
} from '../../../apps/frontend-lib/utilities/messages/markdown-messages.ts';
import { waitForBotToken } from '../../support/bot-verification.ts';
import type { KeyboardOperator } from '../../support/keyboard-operator.ts';
import { markdownEditable } from '../markdown-steps.ts';
import { type ProductInput, upcomingLaunchDates } from '../product-steps.ts';

const SELECT_IMAGE_LABEL = /画像を選択$/u;

const SCREENSHOT_SIZE_PX = 320;

const DEFAULT_IMAGE_SIZE_PX = 64;

const REGISTERED_MESSAGE_PATTERN = /^プロダクトを登録しました。/u;

const MY_PRODUCTS_PATH = '/my/products';

// 画像の内容は問わないため、ブラウザの描画で単色のPNGを作る
async function createSolidPng(page: Page, sizePx: number): Promise<Buffer> {
  const dataUrl = await page.evaluate((size) => {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');
    if (context !== null) {
      context.fillStyle = '#2f6fdb';
      context.fillRect(0, 0, size, size);
    }
    return canvas.toDataURL('image/png');
  }, sizePx);
  return Buffer.from(
    dataUrl.replace(/^data:image\/png;base64,/u, ''),
    'base64',
  );
}

async function chooseFileByKeyboard(
  operator: KeyboardOperator,
  button: Locator,
  name: string,
  fileName: string,
  sizePx: number,
): Promise<void> {
  const { page } = operator;
  const chooserPromise = page.waitForEvent('filechooser');
  await operator.activate(button, name);
  const chooser = await chooserPromise;
  await chooser.setFiles({
    name: fileName,
    mimeType: 'image/png',
    buffer: await createSolidPng(page, sizePx),
  });
}

// 画像の選択のボタンのEnterで選ぶ画面を開き、切り抜きのダイアログの確定をTabとEnterで押す。逃がす確認のため、最初の選択はEscapeで取り消し、フォーカスが選択のボタンへ戻ることを確かめてから選び直す
async function uploadImageByKeyboard(
  operator: KeyboardOperator,
  scope: Locator,
  name: string,
  fileName: string,
  sizePx: number,
  { cancelFirst }: { readonly cancelFirst: boolean },
): Promise<void> {
  const { page } = operator;
  const selectButton = scope.getByRole('button', { name: SELECT_IMAGE_LABEL });
  const cropDialog = page.getByRole('dialog', {
    name: IMAGE_CROP_DIALOG_TITLE,
  });
  if (cancelFirst) {
    await chooseFileByKeyboard(operator, selectButton, name, fileName, sizePx);
    await expect(cropDialog).toBeVisible();
    await expect(cropDialog.getByText(IMAGE_CROP_LOADING_MESSAGE)).toHaveCount(
      0,
    );
    await operator.expectDialogEscapeCloses(
      cropDialog,
      `${name}の切り抜きのダイアログ`,
      selectButton,
    );
  }
  await chooseFileByKeyboard(operator, selectButton, name, fileName, sizePx);
  await expect(cropDialog).toBeVisible();
  await operator.activate(
    cropDialog.getByRole('button', {
      name: IMAGE_CROP_CONFIRM_LABEL,
      exact: true,
    }),
    `${name}の切り抜きの確定`,
  );
  await expect(cropDialog).toHaveCount(0);
  await expect(scope.getByText(UPLOAD_STATUS_UPLOADED)).toBeVisible();
}

// カレンダーの日の読み上げの名前は、業務日付と同じ暦日を日本語の完全な日付の表記で示す
const dayLabelOf = (businessDate: string): string =>
  new Intl.DateTimeFormat('ja-JP', {
    dateStyle: 'full',
    timeZone: 'UTC',
  }).format(new Date(`${businessDate}T00:00:00.000Z`));

async function chooseLaunchDateByKeyboard(
  operator: KeyboardOperator,
  form: Locator,
  launchDate: string,
): Promise<void> {
  const group = form.getByRole('group', {
    name: LAUNCH_DATE_FIELD_LABEL,
    exact: true,
  });
  await operator.focus(
    group.locator('[data-slot="calendar-day-button"][tabindex="0"]'),
    'ローンチ日のカレンダーのTabの停止位置の日',
  );
  await operator.arrowTo(
    group.getByRole('button', { name: dayLabelOf(launchDate), exact: true }),
    `ローンチ日(${launchDate})`,
    'ArrowRight',
    { appearsWhileMoving: true },
  );
  await operator.press('Enter');
  await expect(
    group.getByRole('button', {
      name: `${dayLabelOf(launchDate)}、選択済み`,
      exact: true,
    }),
  ).toBeVisible();
}

// 説明文の編集領域はTabで入り、Tabで出られる。値はフォーカスが外れる時に確定するため、続く欄への移動で確定させる
async function typeDescriptionByKeyboard(
  operator: KeyboardOperator,
  form: Locator,
  text: string,
): Promise<void> {
  await expect(
    form
      .getByRole('toolbar', { name: FORMAT_TOOLBAR_LABEL })
      .getByRole('button', { name: BOLD_ACTION_LABEL, exact: true }),
  ).toBeEnabled();
  const editable = markdownEditable(form, DESCRIPTION_FIELD_LABEL);
  await operator.focus(editable, '説明文の入力欄');
  await operator.page.keyboard.type(text);
  await expect(editable).toContainText(text);
}

// プロダクトの登録のフォームを、キーボードだけで入力して送信する
export async function registerProductByKeyboard(
  operator: KeyboardOperator,
  input: ProductInput,
): Promise<void> {
  const { page } = operator;
  await page.goto('/my/products/new');
  const form = page.getByRole('form', { name: PRODUCT_REGISTER_PAGE_TITLE });
  await waitForBotToken(form);
  const [launchDate] = upcomingLaunchDates();

  await uploadImageByKeyboard(
    operator,
    form.getByRole('region', { name: BASIC_SECTION_HEADING, exact: true }),
    'ロゴ',
    'e2e-keyboard-logo.png',
    DEFAULT_IMAGE_SIZE_PX,
    { cancelFirst: true },
  );
  await operator.type(
    form.getByLabel(NAME_FIELD_LABEL, { exact: true }),
    '名称',
    input.name,
  );
  await operator.type(
    form.getByLabel(TAGLINE_FIELD_LABEL, { exact: true }),
    'タグライン',
    input.tagline,
  );
  await operator.chooseOption(
    form.getByRole('combobox', { name: CATEGORY_FIELD_LABEL, exact: true }),
    input.categoryName,
    'カテゴリ',
    { fromEnd: true },
  );
  await operator.type(
    form.getByLabel(PRODUCT_HANDLE_FIELD_LABEL, { exact: true }),
    'ハンドル',
    input.handle,
  );
  await typeDescriptionByKeyboard(operator, form, input.descriptionText);
  await operator.type(
    form.getByLabel(WEBSITE_URL_FIELD_LABEL, { exact: true }),
    '外部WebサイトURL',
    input.websiteUrl,
  );
  await uploadImageByKeyboard(
    operator,
    form.getByRole('region', {
      name: SCREENSHOTS_SECTION_HEADING,
      exact: true,
    }),
    'スクリーンショット',
    'e2e-keyboard-screenshot.png',
    SCREENSHOT_SIZE_PX,
    { cancelFirst: false },
  );
  await expect(
    form.getByRole('button', { name: screenshotRemoveLabelOf(1), exact: true }),
  ).toBeVisible();
  await chooseLaunchDateByKeyboard(operator, form, launchDate);
  await operator.activate(
    form.getByRole('button', { name: REGISTER_SUBMIT_LABEL, exact: true }),
    'ローンチの予約',
  );
  await expect(page.getByText(REGISTERED_MESSAGE_PATTERN)).toBeVisible();
  await expect(page).toHaveURL((url) => url.pathname === MY_PRODUCTS_PATH);
}
