export type ImageVariantName =
  | 'square-xs'
  | 'square-sm'
  | 'square-md'
  | 'square-lg'
  | 'screenshot-thumb'
  | 'screenshot-thumb-2x'
  | 'screenshot-full';

export type ImageExtension = 'avif' | 'webp' | 'jpg' | 'png' | 'svg';

export type ImageFit = 'cover' | 'scale-down';

export type ImageOriginal = 'svg' | 'raster';

export interface ImageVariantSpec {
  readonly name: ImageVariantName;
  readonly width: number;
  readonly height: number;
  readonly fit: ImageFit;
  readonly avif: boolean;
}

export type ImagePathMatch =
  | {
      readonly kind: 'image';
      readonly objectKey: string;
      readonly variant: ImageVariantName;
      readonly extension: ImageExtension;
    }
  | { readonly kind: 'undefined-variant' }
  | { readonly kind: 'not-image-path' };

export type SquareDisplaySize = 32 | 64 | 128;

export type ScreenshotDisplayKind = 'thumb' | 'full';

export interface DisplayVariants {
  readonly x1: ImageVariantName;
  readonly x2: ImageVariantName | undefined;
}

// 画像の変換基盤は長辺1,200pxを超えるAVIFを出力できない
const AVIF_MAX_LONG_SIDE = 1200;

const variantOf = (
  name: ImageVariantName,
  size: number,
  fit: ImageFit,
): ImageVariantSpec =>
  Object.freeze({
    name,
    width: size,
    height: size,
    fit,
    avif: size <= AVIF_MAX_LONG_SIDE,
  });

export const IMAGE_VARIANTS: Readonly<
  Record<ImageVariantName, ImageVariantSpec>
> = Object.freeze({
  'square-xs': variantOf('square-xs', 32, 'cover'),
  'square-sm': variantOf('square-sm', 64, 'cover'),
  'square-md': variantOf('square-md', 128, 'cover'),
  'square-lg': variantOf('square-lg', 256, 'cover'),
  'screenshot-thumb': variantOf('screenshot-thumb', 480, 'scale-down'),
  'screenshot-thumb-2x': variantOf('screenshot-thumb-2x', 960, 'scale-down'),
  'screenshot-full': variantOf('screenshot-full', 1920, 'scale-down'),
});

export const OBJECT_KEY_PATTERN = /^[0-9a-f]{32}$/;

// 期間は退会した利用者のデータの保持期間(14日)に合わせる
export const IMAGE_CACHE_CONTROL = 'public, max-age=1209600, immutable';

const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set<ImageExtension>([
  'avif',
  'webp',
  'jpg',
  'png',
  'svg',
]);

const IMAGE_VARIANT_NAMES: ReadonlySet<string> = new Set(
  Object.keys(IMAGE_VARIANTS),
);

const IMAGE_PATH_PATTERN =
  /^\/(?<objectKey>[0-9a-f]{32})\/(?<variant>[^/]+)\.(?<extension>[^./]+)$/;

const UNDEFINED_VARIANT: ImagePathMatch = Object.freeze({
  kind: 'undefined-variant',
});

const NOT_IMAGE_PATH: ImagePathMatch = Object.freeze({
  kind: 'not-image-path',
});

const isImageVariantName = (name: string): name is ImageVariantName =>
  IMAGE_VARIANT_NAMES.has(name);

const isImageExtension = (extension: string): extension is ImageExtension =>
  IMAGE_EXTENSIONS.has(extension);

export const buildImagePath = (
  objectKey: string,
  variant: ImageVariantName,
  extension: ImageExtension,
): string => `/${objectKey}/${variant}.${extension}`;

export const parseImagePath = (pathname: string): ImagePathMatch => {
  const groups = IMAGE_PATH_PATTERN.exec(pathname)?.groups;
  if (
    groups?.objectKey === undefined ||
    groups.variant === undefined ||
    groups.extension === undefined
  ) {
    return NOT_IMAGE_PATH;
  }
  const { objectKey, variant, extension } = groups;
  if (!isImageVariantName(variant) || !isImageExtension(extension)) {
    return UNDEFINED_VARIANT;
  }
  return { kind: 'image', objectKey, variant, extension };
};

export const isDeliverable = (
  variant: ImageVariantName,
  extension: ImageExtension,
  original: ImageOriginal,
): boolean => {
  if (original === 'svg') {
    return extension === 'svg';
  }
  if (extension === 'svg') {
    return false;
  }
  return extension !== 'avif' || IMAGE_VARIANTS[variant].avif;
};

const SQUARE_VARIANTS: Readonly<Record<SquareDisplaySize, DisplayVariants>> =
  Object.freeze({
    32: Object.freeze({ x1: 'square-xs', x2: 'square-sm' }),
    64: Object.freeze({ x1: 'square-sm', x2: 'square-md' }),
    128: Object.freeze({ x1: 'square-md', x2: 'square-lg' }),
  });

const SCREENSHOT_VARIANTS: Readonly<
  Record<ScreenshotDisplayKind, DisplayVariants>
> = Object.freeze({
  thumb: Object.freeze({ x1: 'screenshot-thumb', x2: 'screenshot-thumb-2x' }),
  full: Object.freeze({ x1: 'screenshot-full', x2: undefined }),
});

export const squareVariants = (size: SquareDisplaySize): DisplayVariants =>
  SQUARE_VARIANTS[size];

export const screenshotVariants = (
  kind: ScreenshotDisplayKind,
): DisplayVariants => SCREENSHOT_VARIANTS[kind];
