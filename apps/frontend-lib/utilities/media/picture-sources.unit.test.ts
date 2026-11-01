import { describe, expect, test } from 'bun:test';

import {
  buildPictureSources,
  fallbackExtensionOf,
  type MediaImageFallbackFormat,
  type MediaImageView,
  pictureSizeOf,
} from './picture-sources.ts';

const ORIGIN = 'https://images.example';

const KEY = '0123456789abcdef'.repeat(2);

const imageOf = (
  fallbackFormat: MediaImageFallbackFormat,
  width: number | null,
  height: number | null,
): MediaImageView & { readonly objectKey: string } => ({
  objectKey: KEY,
  fallbackFormat,
  width,
  height,
});

const urlOf = (variant: string, extension: string): string =>
  `${ORIGIN}/${KEY}/${variant}.${extension}`;

describe('フォールバックの形式の変換', () => {
  test.each([
    ['JPG', 'jpg'],
    ['PNG', 'png'],
    ['SVG', 'svg'],
  ] as const)(
    'GraphQLの列挙の値%sを配信のURLの拡張子%sにする',
    (format, extension) => {
      expect(fallbackExtensionOf(format)).toBe(extension);
    },
  );
});

describe('<picture>の候補の組み立て', () => {
  test('正方形の32pxは、1xと2xのバリアントでAVIF・WebPの順の候補とJPEGのフォールバックにする', () => {
    expect(
      buildPictureSources({
        origin: ORIGIN,
        image: imageOf('JPG', 1000, 800),
        display: { kind: 'square', size: 32 },
      }),
    ).toEqual({
      sources: [
        {
          type: 'image/avif',
          srcSet: `${urlOf('square-xs', 'avif')} 1x, ${urlOf('square-sm', 'avif')} 2x`,
        },
        {
          type: 'image/webp',
          srcSet: `${urlOf('square-xs', 'webp')} 1x, ${urlOf('square-sm', 'webp')} 2x`,
        },
      ],
      img: {
        src: urlOf('square-xs', 'jpg'),
        srcSet: `${urlOf('square-xs', 'jpg')} 1x, ${urlOf('square-sm', 'jpg')} 2x`,
        width: 32,
        height: 32,
      },
    });
  });

  test.each([
    [64, 'square-sm', 'square-md'],
    [128, 'square-md', 'square-lg'],
  ] as const)(
    '正方形の%ipxは、%sと%sを使い幅・高さを表示サイズにする',
    (size, x1, x2) => {
      const result = buildPictureSources({
        origin: ORIGIN,
        image: imageOf('PNG', 10, 20),
        display: { kind: 'square', size },
      });

      expect(result.img).toEqual({
        src: urlOf(x1, 'png'),
        srcSet: `${urlOf(x1, 'png')} 1x, ${urlOf(x2, 'png')} 2x`,
        width: size,
        height: size,
      });
    },
  );

  test('スクリーンショットの一覧の表示は、1xの上限と原本の縦横比から幅・高さを求める', () => {
    const result = buildPictureSources({
      origin: ORIGIN,
      image: imageOf('PNG', 1920, 1080),
      display: { kind: 'screenshot', variant: 'thumb' },
    });

    expect(result.sources.map((source) => source.type)).toEqual([
      'image/avif',
      'image/webp',
    ]);
    expect(result.img).toEqual({
      src: urlOf('screenshot-thumb', 'png'),
      srcSet: `${urlOf('screenshot-thumb', 'png')} 1x, ${urlOf('screenshot-thumb-2x', 'png')} 2x`,
      width: 480,
      height: 270,
    });
  });

  test('縦長のスクリーンショットは高さを上限にする', () => {
    expect(
      buildPictureSources({
        origin: ORIGIN,
        image: imageOf('JPG', 1080, 1920),
        display: { kind: 'screenshot', variant: 'thumb' },
      }).img,
    ).toMatchObject({ width: 270, height: 480 });
  });

  test('上限より小さい原本は、縮小だけのバリアントと同じく拡大しない寸法にする', () => {
    expect(
      buildPictureSources({
        origin: ORIGIN,
        image: imageOf('JPG', 300, 200),
        display: { kind: 'screenshot', variant: 'thumb' },
      }).img,
    ).toMatchObject({ width: 300, height: 200 });
  });

  test('原本の寸法が無ければ、1xの上限の正方形にする', () => {
    expect(
      buildPictureSources({
        origin: ORIGIN,
        image: imageOf('JPG', null, null),
        display: { kind: 'screenshot', variant: 'thumb' },
      }).img,
    ).toMatchObject({ width: 480, height: 480 });
    expect(
      buildPictureSources({
        origin: ORIGIN,
        image: imageOf('JPG', 1000, null),
        display: { kind: 'screenshot', variant: 'thumb' },
      }).img,
    ).toMatchObject({ width: 480, height: 480 });
  });

  test('拡大表示は2xのバリアントが無く、AVIFを提供しないためWebPだけの候補にする', () => {
    expect(
      buildPictureSources({
        origin: ORIGIN,
        image: imageOf('JPG', 3840, 2160),
        display: { kind: 'screenshot', variant: 'full' },
      }),
    ).toEqual({
      sources: [
        { type: 'image/webp', srcSet: urlOf('screenshot-full', 'webp') },
      ],
      img: {
        src: urlOf('screenshot-full', 'jpg'),
        srcSet: undefined,
        width: 1920,
        height: 1080,
      },
    });
  });

  test('SVGは<source>を出さず、svgの<img>だけにする', () => {
    expect(
      buildPictureSources({
        origin: ORIGIN,
        image: imageOf('SVG', null, null),
        display: { kind: 'square', size: 64 },
      }),
    ).toEqual({
      sources: [],
      img: {
        src: urlOf('square-sm', 'svg'),
        srcSet: undefined,
        width: 64,
        height: 64,
      },
    });
  });

  test('寸法のあるSVGのスクリーンショットは原本の縦横比を使う', () => {
    expect(
      buildPictureSources({
        origin: ORIGIN,
        image: imageOf('SVG', 800, 400),
        display: { kind: 'screenshot', variant: 'thumb' },
      }),
    ).toEqual({
      sources: [],
      img: {
        src: urlOf('screenshot-thumb', 'svg'),
        srcSet: undefined,
        width: 480,
        height: 240,
      },
    });
  });

  test('極端に細長い原本でも幅・高さを1以上にする', () => {
    expect(
      buildPictureSources({
        origin: ORIGIN,
        image: imageOf('PNG', 100_000, 1),
        display: { kind: 'screenshot', variant: 'thumb' },
      }).img,
    ).toMatchObject({ width: 480, height: 1 });
  });
});

describe('表示する寸法', () => {
  test('正方形は、画像の有無によらず表示サイズにする', () => {
    expect(pictureSizeOf({ kind: 'square', size: 128 }, null)).toEqual({
      width: 128,
      height: 128,
    });
    expect(
      pictureSizeOf({ kind: 'square', size: 32 }, { width: 900, height: 300 }),
    ).toEqual({ width: 32, height: 32 });
  });

  test('スクリーンショットは、<img>と同じく1xの上限と原本の縦横比から求める', () => {
    expect(
      pictureSizeOf(
        { kind: 'screenshot', variant: 'thumb' },
        { width: 1920, height: 1080 },
      ),
    ).toEqual({ width: 480, height: 270 });
  });

  test('画像の無いスクリーンショットは、1xの上限の正方形にする', () => {
    expect(
      pictureSizeOf({ kind: 'screenshot', variant: 'full' }, null),
    ).toEqual({ width: 1920, height: 1920 });
  });
});
