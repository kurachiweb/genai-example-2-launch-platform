import { formatFileSize } from '../media/file-size-label.ts';

export const IMAGE_UNAVAILABLE_TEXT = '画像を表示できません';

export const unavailableImageLabel = (alt: string): string =>
  `${alt}(${IMAGE_UNAVAILABLE_TEXT})`;

export const privateFileSizeNote = (bytes: number): string =>
  `(${formatFileSize(bytes)})`;
