export const SCREENSHOTS_HEADING = 'スクリーンショット';

export const screenshotCountLabel = (count: number): string =>
  `${count.toString()}枚`;

export const SCREENSHOT_LIST_LABEL =
  'スクリーンショット一覧(横にスクロールできます)';

export const enlargeScreenshotLabel = (position: number): string =>
  `スクリーンショット${position.toString()}枚目を拡大`;

export const screenshotAlt = (productName: string, position: number): string =>
  `${productName}のスクリーンショット${position.toString()}枚目`;

export const SCROLL_PREVIOUS_SCREENSHOTS_LABEL =
  '前のスクリーンショットへスクロール';

export const SCROLL_NEXT_SCREENSHOTS_LABEL =
  '次のスクリーンショットへスクロール';

export const lightboxTitle = (productName: string): string =>
  `${productName}のスクリーンショット`;

export const lightboxPosition = (position: number, count: number): string =>
  `${position.toString()} / ${count.toString()}`;

export const PREVIOUS_SCREENSHOT_LABEL = '前のスクリーンショット';

export const NEXT_SCREENSHOT_LABEL = '次のスクリーンショット';

export const CLOSE_LIGHTBOX_LABEL = '閉じる';
