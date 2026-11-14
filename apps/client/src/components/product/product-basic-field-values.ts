import type { MediaImageView } from '../../../lib/utilities/media/picture-sources.ts';

// 基本の欄の部品が読み書きするフォームの値。登録・編集のフォームの値(RegisterProductInput・UpdateProductInputと同じくfieldsの下に置く)はこの経路を持つ
export interface ProductBasicFieldValues {
  fields: {
    handle: string;
    categoryId: string;
    // nullは未設定
    logoFileId: string | null;
    // 表示順
    screenshotFileIds: string[];
  };
}

export interface ProductScreenshotEntry {
  readonly fileId: string;
  // nullは画像の記録が無い
  readonly image: MediaImageView | null;
  readonly byteSize: number;
}
