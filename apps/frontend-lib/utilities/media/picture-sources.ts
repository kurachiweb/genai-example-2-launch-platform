import {
  buildImagePath,
  type DisplayVariants,
  IMAGE_VARIANTS,
  type ImageExtension,
  type ImageVariantName,
  type ScreenshotDisplayKind,
  screenshotVariants,
  type SquareDisplaySize,
  squareVariants,
} from '../../../common-lib/media/image-variants.ts';
import type { FallbackFormat } from '../../../common-lib/media/media-types.ts';

// GraphQLの列挙MediaImageFallbackFormatのcodegen(enumsAsTypes)の型と同じ値
export type MediaImageFallbackFormat = 'JPG' | 'PNG' | 'SVG';

export interface MediaImageView {
  // nullは隔離中・削除待ち・未設定
  readonly objectKey: string | null;
  readonly fallbackFormat: MediaImageFallbackFormat;
  readonly width: number | null;
  readonly height: number | null;
}

export type PictureDisplay =
  | { readonly kind: 'square'; readonly size: SquareDisplaySize }
  | { readonly kind: 'screenshot'; readonly variant: ScreenshotDisplayKind };

export interface PictureSource {
  readonly type: 'image/avif' | 'image/webp';
  readonly srcSet: string;
}

export interface PictureSources {
  readonly sources: readonly PictureSource[];
  readonly img: {
    readonly src: string;
    readonly srcSet: string | undefined;
    readonly width: number;
    readonly height: number;
  };
}

export interface PictureSourcesInput {
  readonly origin: string;
  readonly image: MediaImageView & { readonly objectKey: string };
  readonly display: PictureDisplay;
}

export interface PictureSize {
  readonly width: number;
  readonly height: number;
}

const FALLBACK_EXTENSIONS: Readonly<
  Record<MediaImageFallbackFormat, FallbackFormat>
> = Object.freeze({ JPG: 'jpg', PNG: 'png', SVG: 'svg' });

export const fallbackExtensionOf = (
  format: MediaImageFallbackFormat,
): FallbackFormat => FALLBACK_EXTENSIONS[format];

const variantsOf = (display: PictureDisplay): DisplayVariants =>
  display.kind === 'square'
    ? squareVariants(display.size)
    : screenshotVariants(display.variant);

const providesAvif = (variants: DisplayVariants): boolean =>
  IMAGE_VARIANTS[variants.x1].avif &&
  (variants.x2 === undefined || IMAGE_VARIANTS[variants.x2].avif);

const isPositive = (value: number | null): value is number =>
  value !== null && value > 0;

// スクリーンショットのバリアントは縮小だけのため、上限の正方形に収まるよう縮め、上限より小さい原本は拡大しない
const fittedSize = (
  limit: number,
  image: Pick<MediaImageView, 'width' | 'height'> | null,
): PictureSize => {
  const width = image?.width ?? null;
  const height = image?.height ?? null;
  if (!isPositive(width) || !isPositive(height)) {
    return { width: limit, height: limit };
  }
  const scale = Math.min(1, limit / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
};

// 画像が無い・表示できない場合のプレースホルダーも、<img>と同じ寸法にしてレイアウトのずれを防ぐ
export const pictureSizeOf = (
  display: PictureDisplay,
  image: Pick<MediaImageView, 'width' | 'height'> | null,
): PictureSize =>
  display.kind === 'square'
    ? { width: display.size, height: display.size }
    : fittedSize(IMAGE_VARIANTS[variantsOf(display).x1].width, image);

export const buildPictureSources = (
  input: PictureSourcesInput,
): PictureSources => {
  const { origin, image, display } = input;
  const variants = variantsOf(display);
  const urlOf = (variant: ImageVariantName, extension: ImageExtension) =>
    `${origin}${buildImagePath(image.objectKey, variant, extension)}`;
  const srcSetOf = (extension: ImageExtension): string =>
    variants.x2 === undefined
      ? urlOf(variants.x1, extension)
      : `${urlOf(variants.x1, extension)} 1x, ${urlOf(variants.x2, extension)} 2x`;
  const size = pictureSizeOf(display, image);
  const fallback = fallbackExtensionOf(image.fallbackFormat);
  if (fallback === 'svg') {
    return {
      sources: [],
      img: { src: urlOf(variants.x1, 'svg'), srcSet: undefined, ...size },
    };
  }
  const sources: readonly PictureSource[] = [
    ...(providesAvif(variants)
      ? [{ type: 'image/avif', srcSet: srcSetOf('avif') } as const]
      : []),
    { type: 'image/webp', srcSet: srcSetOf('webp') },
  ];
  return {
    sources,
    img: {
      src: urlOf(variants.x1, fallback),
      srcSet: variants.x2 === undefined ? undefined : srcSetOf(fallback),
      ...size,
    },
  };
};
