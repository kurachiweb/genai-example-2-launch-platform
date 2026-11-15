import { describe, expect, test } from 'bun:test';

import type { ImageMediaType } from '../../../common-lib/media/media-types.ts';
import {
  DEFAULT_PIXEL_LIMITS,
  DIMENSION_PREFIX_BYTES,
  exceedsPixelLimits,
  readImageDimensions,
} from './image-dimensions.ts';

const ascii = (text: string): number[] =>
  Array.from(text, (character) => character.charCodeAt(0));

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

const bytesOf = (...parts: readonly (readonly number[])[]): Uint8Array =>
  Uint8Array.from(parts.flat());

const uint16BE = (value: number): number[] => [
  (value >> 8) & 0xff,
  value & 0xff,
];

const uint16LE = (value: number): number[] => [
  value & 0xff,
  (value >> 8) & 0xff,
];

const uint24LE = (value: number): number[] => [
  value & 0xff,
  (value >> 8) & 0xff,
  (value >> 16) & 0xff,
];

const uint32BE = (value: number): number[] => [
  (value >>> 24) & 0xff,
  (value >> 16) & 0xff,
  (value >> 8) & 0xff,
  value & 0xff,
];

const uint32LE = (value: number): number[] => uint32BE(value).toReversed();

const ORIENTATION_TAG = 0x0112;

const SHORT_TYPE = 3;

// TIFFのヘッダー(ビッグエンディアン、最初のIFDは8バイト目)と、向きのタグだけを持つIFD
const exifSegment = (orientation: number): number[] => {
  const body = [
    ...ascii('Exif'),
    0x00,
    0x00,
    ...ascii('MM'),
    ...uint16BE(0x002a),
    ...uint32BE(8),
    ...uint16BE(1),
    ...uint16BE(ORIENTATION_TAG),
    ...uint16BE(SHORT_TYPE),
    ...uint32BE(1),
    ...uint16BE(orientation),
    0x00,
    0x00,
    ...uint32BE(0),
  ];
  return [0xff, 0xe1, ...uint16BE(body.length + 2), ...body];
};

const jfifSegment = (): number[] => {
  const body = [...ascii('JFIF'), 0x00, 0x01, 0x01, 0x00, 0, 1, 0, 1, 0, 0];
  return [0xff, 0xe0, ...uint16BE(body.length + 2), ...body];
};

const paddingSegment = (length: number): number[] => [
  0xff,
  0xee,
  ...uint16BE(length + 2),
  ...Array.from({ length }, () => 0),
];

const startOfFrame = (width: number, height: number): number[] => [
  0xff,
  0xc0,
  ...uint16BE(17),
  8,
  ...uint16BE(height),
  ...uint16BE(width),
  3,
  1,
  0x22,
  0,
  2,
  0x11,
  1,
  3,
  0x11,
  1,
];

const END_OF_IMAGE = [0xff, 0xd9];

const jpeg = (
  width: number,
  height: number,
  options: {
    readonly orientation?: number;
    readonly padding?: readonly number[];
  } = {},
): Uint8Array =>
  bytesOf(
    [0xff, 0xd8],
    options.orientation === undefined
      ? jfifSegment()
      : exifSegment(options.orientation),
    ...(options.padding ?? []).map(paddingSegment),
    startOfFrame(width, height),
    END_OF_IMAGE,
  );

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const png = (width: number, height: number): Uint8Array =>
  bytesOf(
    PNG_SIGNATURE,
    uint32BE(13),
    ascii('IHDR'),
    uint32BE(width),
    uint32BE(height),
    [8, 6, 0, 0, 0],
    uint32BE(0),
  );

const gif = (width: number, height: number): Uint8Array =>
  bytesOf(
    ascii('GIF89a'),
    uint16LE(width),
    uint16LE(height),
    [0, 0, 0],
    [0x3b],
  );

const riff = (chunk: readonly number[]): Uint8Array =>
  bytesOf(ascii('RIFF'), uint32LE(chunk.length + 4), ascii('WEBP'), chunk);

const webpExtended = (width: number, height: number): Uint8Array =>
  riff([
    ...ascii('VP8X'),
    ...uint32LE(10),
    0x00,
    0,
    0,
    0,
    ...uint24LE(width - 1),
    ...uint24LE(height - 1),
  ]);

const webpLossy = (width: number, height: number): Uint8Array =>
  riff([
    ...ascii('VP8 '),
    ...uint32LE(10),
    0x9d,
    0x01,
    0x00,
    0x9d,
    0x01,
    0x2a,
    ...uint16LE(width),
    ...uint16LE(height),
  ]);

const webpLossless = (width: number, height: number): Uint8Array => {
  const packed = (width - 1) | ((height - 1) << 14);
  return riff([...ascii('VP8L'), ...uint32LE(5), 0x2f, ...uint32LE(packed)]);
};

const svg = (attributes: string): Uint8Array =>
  utf8(
    `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" ${attributes}><rect width="1" height="1"/></svg>`,
  );

describe('readImageDimensions', () => {
  test.each<readonly [string, Uint8Array, ImageMediaType, number, number]>([
    ['JPEG', jpeg(640, 480), 'image/jpeg', 640, 480],
    ['PNG', png(1200, 630), 'image/png', 1200, 630],
    ['GIF', gif(320, 200), 'image/gif', 320, 200],
    ['WebP(VP8X)', webpExtended(1920, 1080), 'image/webp', 1920, 1080],
    ['WebP(VP8)', webpLossy(800, 600), 'image/webp', 800, 600],
    ['WebP(VP8L)', webpLossless(300, 150), 'image/webp', 300, 150],
  ])('%sの先頭から幅と高さを読み取る', (_label, bytes, type, width, height) => {
    expect(readImageDimensions(bytes, type)).toEqual({ width, height });
  });

  test.each([1, 2, 3, 4])(
    'JPEGの向き%iは幅と高さをそのまま返す',
    (orientation) => {
      expect(
        readImageDimensions(jpeg(640, 480, { orientation }), 'image/jpeg'),
      ).toEqual({ width: 640, height: 480 });
    },
  );

  test.each([5, 6, 7, 8])(
    'JPEGの向き%iは幅と高さを入れ替えた表示の向きで返す',
    (orientation) => {
      expect(
        readImageDimensions(jpeg(640, 480, { orientation }), 'image/jpeg'),
      ).toEqual({ width: 480, height: 640 });
    },
  );

  test('JPEGの向きが1〜8の範囲外なら幅と高さを入れ替えない', () => {
    expect(
      readImageDimensions(jpeg(640, 480, { orientation: 9 }), 'image/jpeg'),
    ).toEqual({ width: 640, height: 480 });
  });

  test.each<readonly [string, string, number, number]>([
    ['幅と高さ', 'width="200" height="100"', 200, 100],
    ['単位付きの幅と高さ', 'width="2in" height="1in"', 192, 96],
    ['viewBoxだけ', 'viewBox="0 0 300 150"', 300, 150],
    ['幅とviewBox', 'width="600" viewBox="0 0 300 150"', 600, 300],
    ['高さとviewBox', 'height="300" viewBox="0 0 300 150"', 600, 300],
    ['カンマ区切りのviewBoxだけ', 'viewBox="0,0,300,150"', 300, 150],
    ['pcの幅と大文字の単位の高さ', 'width="12.5pc" height="100PX"', 200, 100],
    ['文字参照の入った幅と高さ', 'width="2&#48;0" height="1&#x30;0"', 200, 100],
  ])('SVGの%sから寸法を読み取る', (_label, attributes, width, height) => {
    expect(readImageDimensions(svg(attributes), 'image/svg+xml')).toEqual({
      width,
      height,
    });
  });

  test.each<readonly [string, string]>([
    [
      '1,000文字を超えるコメントの後のルート',
      `<!--${'x'.repeat(1200)}--><svg xmlns="http://www.w3.org/2000/svg" width="8000" height="8000"/>`,
    ],
    [
      'ルートの前のコメントの中の偽のsvg要素',
      '<!-- <svg width="10" height="10"> --><svg xmlns="http://www.w3.org/2000/svg" width="8000" height="8000"/>',
    ],
    [
      '`=`の前後に空白と改行のある属性',
      `<svg\nxmlns="http://www.w3.org/2000/svg"\n width = "8000"\n height='8000'/>`,
    ],
    [
      'XML宣言と処理命令の後のルート',
      '<?xml version="1.0"?><?foo bar?><svg xmlns="http://www.w3.org/2000/svg" width="8000" height="8000"/>',
    ],
    [
      'SVG 1.1の標準の文書型宣言の後のルート',
      '<?xml version="1.0"?>\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n<svg xmlns="http://www.w3.org/2000/svg" width="8000" height="8000"/>',
    ],
  ])('SVGの%sから幅と高さを読み取る', (_label, text) => {
    expect(readImageDimensions(utf8(text), 'image/svg+xml')).toEqual({
      width: 8000,
      height: 8000,
    });
  });

  test.each([
    ['幅・高さ・viewBoxのいずれも無い', ''],
    ['単位付きの値を含むviewBox', 'viewBox="0 0 300px 150px"'],
    ['子要素だけの幅と高さ', 'data-x="1"><svg width="200" height="100"></svg'],
    ['幅だけ', 'width="200"'],
    ['百分率の幅と高さ', 'width="100%" height="100%"'],
    ['ブラウザが無効とする末尾のカンマのviewBox', 'viewBox="0,0,300,150,"'],
    ['書体で長さが変わるexの幅と高さ', 'width="100ex" height="100ex"'],
    ['幅と高さが0', 'width="0" height="0"'],
  ])('SVGの%sは寸法を未設定にする', (_label, attributes) => {
    expect(
      readImageDimensions(svg(attributes), 'image/svg+xml'),
    ).toBeUndefined();
  });

  test.each<readonly [string, Uint8Array, ImageMediaType]>([
    ['PNGの申告にJPEGの本文', jpeg(640, 480), 'image/png'],
    ['JPEGの申告にPNGの本文', png(640, 480), 'image/jpeg'],
    ['WebPの申告にGIFの本文', gif(16, 16), 'image/webp'],
    ['SVGの申告にPNGの本文', png(16, 16), 'image/svg+xml'],
    ['PNGの申告にSVGの本文', svg('width="16" height="16"'), 'image/png'],
  ])(
    '判定した形式と申告が違う%sは読めないものとして扱う',
    (_label, bytes, type) => {
      expect(readImageDimensions(bytes, type)).toBeUndefined();
    },
  );

  test.each<readonly [string, Uint8Array, ImageMediaType]>([
    ['空のバイト列', new Uint8Array(0), 'image/png'],
    ['シグネチャだけのPNG', bytesOf(PNG_SIGNATURE), 'image/png'],
    [
      'IHDRの無いPNG',
      bytesOf(PNG_SIGNATURE, uint32BE(13), ascii('IDAT')),
      'image/png',
    ],
    [
      'SOFの無いJPEG',
      bytesOf([0xff, 0xd8], jfifSegment(), END_OF_IMAGE),
      'image/jpeg',
    ],
    ['幅と高さが0のPNG', png(0, 0), 'image/png'],
    ['幅が0のGIF', gif(0, 10), 'image/gif'],
    [
      'TIFFの本文',
      bytesOf(ascii('MM'), uint16BE(0x002a), uint32BE(8)),
      'image/jpeg',
    ],
    [
      'BMPの本文',
      bytesOf(
        ascii('BM'),
        Array.from({ length: 30 }, () => 1),
      ),
      'image/png',
    ],
  ])('%sは寸法を読めない', (_label, bytes, type) => {
    expect(readImageDimensions(bytes, type)).toBeUndefined();
  });

  test('先頭1MiBに寸法の無いJPEGは、その後に寸法があっても読めないものとして扱う', () => {
    const largeHead = Array.from({ length: 17 }, () => 65_000);
    const bytes = jpeg(640, 480, { padding: largeHead });

    expect(bytes.length).toBeGreaterThan(DIMENSION_PREFIX_BYTES);
    expect(readImageDimensions(bytes, 'image/jpeg')).toBeUndefined();
  });

  test('先頭1MiBの中に寸法があれば、それより長いJPEGでも読み取る', () => {
    const bytes = bytesOf(
      Array.from(
        jpeg(640, 480, { padding: Array.from({ length: 16 }, () => 65_000) }),
      ),
      Array.from({ length: 64 * 1024 }, () => 0),
    );

    expect(bytes.length).toBeGreaterThan(DIMENSION_PREFIX_BYTES);
    expect(readImageDimensions(bytes, 'image/jpeg')).toEqual({
      width: 640,
      height: 480,
    });
  });

  test('印の並びが壊れた1MiBのJPEGを、先頭の長さに比例する時間で読めないと判断する', () => {
    const bytes = new Uint8Array(DIMENSION_PREFIX_BYTES);
    bytes.set([0xff, 0xd8, 0xff, 0xe0]);

    const startedAt = performance.now();

    expect(readImageDimensions(bytes, 'image/jpeg')).toBeUndefined();
    expect(performance.now() - startedAt).toBeLessThan(2_000);
  });

  test('SOFの印が先頭1MiBの最後の2バイトにあり、幅と高さが1MiBの後ろにあるJPEGは読めないものとして扱う', () => {
    const fullSegments = Array.from({ length: 16 }, () => 65_000);
    const headLength =
      2 +
      jfifSegment().length +
      fullSegments.reduce((sum, length) => sum + length + 4, 0);
    const lastPadding = DIMENSION_PREFIX_BYTES - 2 - headLength - 4;
    const bytes = jpeg(640, 480, { padding: [...fullSegments, lastPadding] });

    expect(bytes[DIMENSION_PREFIX_BYTES - 2]).toBe(0xff);
    expect(bytes[DIMENSION_PREFIX_BYTES - 1]).toBe(0xc0);
    expect(readImageDimensions(bytes, 'image/jpeg')).toBeUndefined();
  });

  test('より大きいバッファの部分配列を渡されても、部分配列の外を読まない', () => {
    const whole = png(10, 20);
    const headOnly = whole.subarray(0, 16);

    expect(readImageDimensions(whole, 'image/png')).toEqual({
      width: 10,
      height: 20,
    });
    expect(readImageDimensions(headOnly, 'image/png')).toBeUndefined();
  });

  test('受け取ったバイト列を書き換えない', () => {
    const bytes = jpeg(640, 480, { orientation: 6 });
    const before = Uint8Array.from(bytes);

    readImageDimensions(bytes, 'image/jpeg');

    expect(bytes).toEqual(before);
  });
});

describe('exceedsPixelLimits', () => {
  test('既定の上限は1,600万画素・各辺12,000pxで、書き換えられない', () => {
    expect(DEFAULT_PIXEL_LIMITS).toEqual({
      maxPixels: 16_000_000,
      maxSide: 12_000,
    });
    expect(Object.isFrozen(DEFAULT_PIXEL_LIMITS)).toBe(true);
  });

  test('寸法の読み取りに使う先頭の長さは1MiB', () => {
    expect(DIMENSION_PREFIX_BYTES).toBe(1_048_576);
  });

  test.each<readonly [number, number, boolean]>([
    [4000, 4000, false],
    [4000, 4001, true],
    [12_000, 1333, false],
    [12_000, 1334, true],
    [12_000, 1, false],
    [12_001, 1, true],
    [1, 12_000, false],
    [1, 12_001, true],
    [1, 1, false],
  ])('%i×%ipxの上限の超過は%p', (width, height, expected) => {
    expect(exceedsPixelLimits({ width, height }, DEFAULT_PIXEL_LIMITS)).toBe(
      expected,
    );
  });

  test('渡した上限で判定する', () => {
    const limits = { maxPixels: 100, maxSide: 20 };

    expect(exceedsPixelLimits({ width: 10, height: 10 }, limits)).toBe(false);
    expect(exceedsPixelLimits({ width: 10, height: 11 }, limits)).toBe(true);
    expect(exceedsPixelLimits({ width: 21, height: 1 }, limits)).toBe(true);
  });
});
