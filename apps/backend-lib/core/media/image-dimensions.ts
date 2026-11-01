import { disableTypes, imageSize, types } from 'image-size';

import type { ImageMediaType } from '../../../common-lib/media/media-types.ts';

export interface ImageDimensions {
  readonly width: number;
  readonly height: number;
}

export interface PixelLimits {
  readonly maxPixels: number;
  readonly maxSide: number;
}

export const DEFAULT_PIXEL_LIMITS: PixelLimits = Object.freeze({
  maxPixels: 16_000_000,
  maxSide: 12_000,
});

export const DIMENSION_PREFIX_BYTES = 1_048_576;

type ImageSizeType = (typeof types)[number];

const IMAGE_SIZE_TYPE_BY_MEDIA_TYPE: Readonly<
  Record<ImageMediaType, ImageSizeType>
> = Object.freeze({
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
});

const ENABLED_IMAGE_SIZE_TYPES: ReadonlySet<ImageSizeType> = new Set(
  Object.values(IMAGE_SIZE_TYPE_BY_MEDIA_TYPE),
);

// image-sizeの無効化は同じisolateの全呼び出しに効くため、受け付ける5形式以外を判定しない設定として読み込み時に1度だけ行う
disableTypes(types.filter((type) => !ENABLED_IMAGE_SIZE_TYPES.has(type)));

// EXIFの向き5〜8は90度・270度の回転を含み、表示される幅と高さが入れ替わる
const ROTATED_ORIENTATIONS: ReadonlySet<number> = new Set([5, 6, 7, 8]);

// image-sizeはJPEGの印を探す時に1バイトずつslice()で複製するため、壊れた本文で先頭の長さの2乗の時間がかかる。複製しない部分配列を返すことで線形に抑える
class SharedViewBytes extends Uint8Array {
  override slice(start?: number, end?: number): Uint8Array<ArrayBuffer> {
    return this.subarray(start, end);
  }
}

// image-sizeは部分配列の長さではなく.bufferの末尾までをDataViewで読むため、先頭部分だけを持つバッファへ1度だけ複製して渡す
const prefixViewOf = (bytes: Uint8Array): SharedViewBytes =>
  new SharedViewBytes(bytes.subarray(0, DIMENSION_PREFIX_BYTES));

const isPositiveLength = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

export function readImageDimensions(
  bytes: Uint8Array,
  type: ImageMediaType,
): ImageDimensions | undefined {
  let size: ReturnType<typeof imageSize>;
  try {
    size = imageSize(prefixViewOf(bytes));
  } catch {
    return undefined;
  }
  if (
    size.type !== IMAGE_SIZE_TYPE_BY_MEDIA_TYPE[type] ||
    !isPositiveLength(size.width) ||
    !isPositiveLength(size.height)
  ) {
    return undefined;
  }
  return size.orientation !== undefined &&
    ROTATED_ORIENTATIONS.has(size.orientation)
    ? Object.freeze({ width: size.height, height: size.width })
    : Object.freeze({ width: size.width, height: size.height });
}

export function exceedsPixelLimits(
  dimensions: ImageDimensions,
  limits: PixelLimits,
): boolean {
  return (
    dimensions.width > limits.maxSide ||
    dimensions.height > limits.maxSide ||
    dimensions.width * dimensions.height > limits.maxPixels
  );
}
