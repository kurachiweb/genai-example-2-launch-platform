import { expect, type Locator, type Page } from '@playwright/test';

import {
  IMAGE_CROP_CONFIRM_LABEL,
  IMAGE_CROP_DIALOG_TITLE,
} from '../../apps/frontend-lib/utilities/messages/media-crop-messages.ts';
import { UPLOAD_STATUS_UPLOADED } from '../../apps/frontend-lib/utilities/messages/media-upload-messages.ts';

const DEFAULT_IMAGE_SIZE_PX = 64;

export interface UploadImageOptions {
  readonly fileName: string;
  readonly sizePx?: number;
}

// 画像の内容は問わないため、ブラウザの描画で単色のPNGを作り、テストのファイルをリポジトリに置かない
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

// 画像のアップロードの欄は、選んだ画像ごとに切り抜きのダイアログを開き、確定した画像を送る。範囲の中の入力欄が1つだけの欄で、送信を終えた表示まで待つ
export async function uploadCroppedImage(
  page: Page,
  scope: Locator,
  { fileName, sizePx = DEFAULT_IMAGE_SIZE_PX }: UploadImageOptions,
): Promise<void> {
  await scope.locator('input[type="file"]').setInputFiles({
    name: fileName,
    mimeType: 'image/png',
    buffer: await createSolidPng(page, sizePx),
  });
  const cropDialog = page.getByRole('dialog', {
    name: IMAGE_CROP_DIALOG_TITLE,
  });
  await cropDialog
    .getByRole('button', { name: IMAGE_CROP_CONFIRM_LABEL, exact: true })
    .click();
  await expect(cropDialog).toHaveCount(0);
  await expect(scope.getByText(UPLOAD_STATUS_UPLOADED)).toBeVisible();
}
