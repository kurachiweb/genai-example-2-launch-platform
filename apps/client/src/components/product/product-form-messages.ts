import {
  PRODUCT_SCREENSHOTS_MAX,
  PRODUCT_SCREENSHOTS_TOTAL_MAX_BYTES,
} from '../../../common-lib/product/product-input-rules.ts';
import { formatFileSize } from '../../../lib/utilities/media/file-size-label.ts';

// APIサーバーの保存の拒否(apps/apiのsrc/application/product/product-errors.tsのhandle_unavailable)と同じ文言にする
export const PRODUCT_FORM_MESSAGES = Object.freeze({
  handleUnavailable:
    'このハンドルは既に使われています。別の文字列を入力してください。',
});

export const LOGO_FIELD_LABEL = 'ロゴ(必須)';

export const LOGO_SUBJECT_LABEL = 'ロゴ';

export const LOGO_SELECT_LABEL = '画像を選択';

export const LOGO_REPLACE_LABEL = 'ロゴを差し替え';

export const CATEGORY_FIELD_LABEL = 'カテゴリ(必須)';

export const CATEGORY_PLACEHOLDER = '選択してください';

export const PRODUCT_HANDLE_FIELD_LABEL = 'ハンドル(必須)';

export const PRODUCT_HANDLE_PREFIX = '/p/';

export const previousProductHandleGuidanceOf = (
  previousHandle: string,
): string =>
  `以前のハンドル${previousHandle}は、次にハンドルを変更するか他のプロダクトが同じハンドルを設定するまで、新しいURLへ転送されます。`;

export const SCREENSHOTS_FIELD_LABEL = 'スクリーンショット';

export const SCREENSHOT_SUBJECT_LABEL = 'スクリーンショット';

export const SCREENSHOTS_SELECT_LABEL = '画像を選択';

export const SCREENSHOT_REMOVE_LABEL = '取り除く';

export const screenshotAltOf = (position: number): string =>
  `スクリーンショット${String(position)}`;

export const screenshotRemoveLabelOf = (position: number): string =>
  `${screenshotAltOf(position)}を${SCREENSHOT_REMOVE_LABEL}`;

export const screenshotTotalsOf = (count: number, totalBytes: number): string =>
  `${String(count)}/${String(PRODUCT_SCREENSHOTS_MAX)}枚・${formatFileSize(totalBytes)}/${formatFileSize(PRODUCT_SCREENSHOTS_TOTAL_MAX_BYTES)}`;

export const LAUNCH_DATE_FIELD_LABEL = 'ローンチ日(必須)';
