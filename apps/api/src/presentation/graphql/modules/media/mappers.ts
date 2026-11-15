import {
  type FallbackFormat,
  fallbackFormatOf,
  isImageMediaType,
  type MediaType,
} from '../../../../../common-lib/media/media-types.ts';
import { downloadPathOf } from '../../../../../common-lib/media/upload-protocol.ts';
import type { MediaFileView } from '../../../../../lib/core/media/media-file.ts';

export type MediaImageFallbackFormat = 'JPG' | 'PNG' | 'SVG';

export interface MediaImageModel {
  readonly id: string;
  readonly objectKey: string | null;
  readonly fallbackFormat: MediaImageFallbackFormat;
  readonly width: number | null;
  readonly height: number | null;
}

export interface MediaAttachmentModel {
  readonly id: string;
  readonly originalFileName: string;
  readonly contentType: MediaType;
  readonly byteSize: number;
  readonly downloadPath: string;
}

const FALLBACK_FORMATS = Object.freeze({
  jpg: 'JPG',
  png: 'PNG',
  svg: 'SVG',
} as const satisfies Record<FallbackFormat, MediaImageFallbackFormat>);

// 論理削除済みの画像は物理削除まで配信を止めないため、キーを返す
function isDeliverable(file: MediaFileView): boolean {
  return file.stored && !file.eraseRequested && !file.quarantined;
}

export function toMediaImage(file: MediaFileView): MediaImageModel {
  const { contentType } = file;
  if (file.storage !== 'images' || !isImageMediaType(contentType)) {
    throw new TypeError(
      `ファイル${file.id}は画像用の用途の画像ではありません。`,
    );
  }
  return {
    id: file.id,
    objectKey: isDeliverable(file) ? file.objectKey : null,
    fallbackFormat: FALLBACK_FORMATS[fallbackFormatOf(contentType)],
    width: file.width,
    height: file.height,
  };
}

export function toMediaAttachment(file: MediaFileView): MediaAttachmentModel {
  if (file.storage !== 'files') {
    throw new TypeError(
      `ファイル${file.id}はファイル用の用途のファイルではありません。`,
    );
  }
  return {
    id: file.id,
    originalFileName: file.originalFileName,
    contentType: file.contentType,
    byteSize: file.byteSize,
    downloadPath: downloadPathOf(file.id),
  };
}
