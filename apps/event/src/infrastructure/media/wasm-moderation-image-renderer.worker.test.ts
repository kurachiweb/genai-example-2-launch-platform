import { imageSize } from 'image-size';
import { describe, expect, test } from 'vitest';

import type { ImageMediaType } from '../../../common-lib/media/media-types.ts';
import type { ModerationImagePlan } from '../../application/media/ports.ts';
import { WasmModerationImageRenderer } from './wasm-moderation-image-renderer.ts';
import {
  BLACK,
  BLUE,
  convert,
  decode,
  expectNear,
  pixelAt,
  planFor,
  pngOf,
  RED,
  renderer,
  renderOk,
  type Rgba,
  svgOf,
  WHITE,
} from './wasm-moderation-image-renderer.fixtures.ts';

const topRedBottomBlue =
  (height: number) =>
  (_x: number, y: number): Rgba =>
    y < height / 2 ? RED : BLUE;

const leftRedRightBlue =
  (width: number) =>
  (x: number): Rgba =>
    x < width / 2 ? RED : BLUE;

// IFD0に向き(0x0112)の1項目だけを持つビッグエンディアンのExifのAPP1
function exifOrientationSegment(orientation: number): Uint8Array {
  const exifHeader = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00];
  const tiffHeader = [0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08];
  const orientationEntry = [
    0x01,
    0x12,
    0x00,
    0x03,
    0x00,
    0x00,
    0x00,
    0x01,
    0x00,
    orientation,
    0x00,
    0x00,
  ];
  const body = [
    ...exifHeader,
    ...tiffHeader,
    0x00,
    0x01,
    ...orientationEntry,
    0x00,
    0x00,
    0x00,
    0x00,
  ];
  const length = body.length + 2;
  return Uint8Array.from([0xff, 0xe1, length >> 8, length & 0xff, ...body]);
}

const withExifOrientation = (
  jpeg: Uint8Array,
  orientation: number,
): Uint8Array =>
  Uint8Array.from([
    ...jpeg.subarray(0, 2),
    ...exifOrientationSegment(orientation),
    ...jpeg.subarray(2),
  ]);

const GIF_HEADER = [
  ...new TextEncoder().encode('GIF89a'),
  0x02,
  0x00,
  0x02,
  0x00,
  0x00,
  0x00,
  0x00,
];
const NETSCAPE_LOOP = [
  0x21,
  0xff,
  0x0b,
  ...new TextEncoder().encode('NETSCAPE2.0'),
  0x03,
  0x01,
  0x00,
  0x00,
  0x00,
];
const GRAPHIC_CONTROL = [0x21, 0xf9, 0x04, 0x00, 0x32, 0x00, 0x00, 0x00];
// 2×2の画像記述子(局所の2色の色表あり)と、4画素とも色番号0のLZWの画素データ
const FRAME_DESCRIPTOR = [
  0x2c, 0x00, 0x00, 0x00, 0x00, 0x02, 0x00, 0x02, 0x00, 0x80,
];
const ALL_FIRST_COLOR_LZW = [0x02, 0x02, 0x84, 0x51, 0x00];
const GIF_TRAILER = 0x3b;

// 各フレームが1色で塗られた2×2の繰り返しのGIFアニメーション
function animatedGifOf(frameColors: readonly Rgba[]): Uint8Array {
  const frames = frameColors.flatMap(([red, green, blue]) => [
    ...GRAPHIC_CONTROL,
    ...FRAME_DESCRIPTOR,
    red,
    green,
    blue,
    0x00,
    0x00,
    0x00,
    ...ALL_FIRST_COLOR_LZW,
  ]);
  return Uint8Array.from([
    ...GIF_HEADER,
    ...NETSCAPE_LOOP,
    ...frames,
    GIF_TRAILER,
  ]);
}

describe('WasmModerationImageRenderer', () => {
  describe('そのまま送る計画', () => {
    test.each<[string, ImageMediaType, 'png' | 'jpeg']>([
      ['PNG', 'image/png', 'png'],
      ['JPEG', 'image/jpeg', 'jpeg'],
    ])('%sの原本を変えずに計画の形式で返す', async (_label, type, format) => {
      const png = await pngOf(120, 100, () => RED);
      const original = format === 'png' ? png : await convert(png, 'jpeg');
      const plan = planFor(type, 120, 100, original);
      expect(plan).toStrictEqual({ kind: 'as-is', format });

      expect(await renderer().render({ original, plan })).toStrictEqual({
        ok: true,
        image: { bytes: original, format },
      });
    });
  });

  describe('縮小・形式の変換の計画', () => {
    test('長辺の大きいJPEGを縦横比を保って長辺640pxのJPEGに縮小する', async () => {
      const original = await convert(
        await pngOf(1600, 1200, topRedBottomBlue(1200)),
        'jpeg',
      );
      const plan = planFor('image/jpeg', 1600, 1200, original);
      expect(plan).toStrictEqual({
        kind: 'resize',
        width: 640,
        height: 480,
        format: 'jpeg',
      });

      const image = await renderOk(original, plan);

      expect(image.format).toBe('jpeg');
      expect(imageSize(image.bytes)).toStrictEqual({
        width: 640,
        height: 480,
        type: 'jpg',
      });
      const decoded = await decode(image.bytes);
      expectNear(pixelAt(decoded, 320, 100), RED);
      expectNear(pixelAt(decoded, 320, 380), BLUE);
    });

    test('WebPを同じ寸法のPNGへ変換する', async () => {
      const original = await convert(
        await pngOf(200, 100, leftRedRightBlue(200)),
        'webp',
      );
      const plan = planFor('image/webp', 200, 100, original);
      expect(plan).toStrictEqual({
        kind: 'resize',
        width: 200,
        height: 100,
        format: 'png',
      });

      const image = await renderOk(original, plan);

      expect(image.format).toBe('png');
      expect(imageSize(image.bytes)).toStrictEqual({
        width: 200,
        height: 100,
        type: 'png',
      });
      const decoded = await decode(image.bytes);
      expectNear(pixelAt(decoded, 50, 50), RED);
      expectNear(pixelAt(decoded, 150, 50), BLUE);
    });

    test('長辺の大きいSVGを長辺640pxのPNGに描画する', async () => {
      const original = svgOf(1280, 320, 'red');
      const plan = planFor('image/svg+xml', 1280, 320, original);
      expect(plan).toStrictEqual({
        kind: 'resize',
        width: 640,
        height: 160,
        format: 'png',
      });

      const image = await renderOk(original, plan);

      expect(image.format).toBe('png');
      expect(imageSize(image.bytes)).toStrictEqual({
        width: 640,
        height: 160,
        type: 'png',
      });
      expect(pixelAt(await decode(image.bytes), 320, 80)).toStrictEqual(RED);
    });

    // 計画の寸法はExifの向きを適用した表示上の寸法のため、描画も向きを適用しないと縦横が食い違う
    test.each<[number, Rgba, Rgba]>([
      [6, RED, BLUE],
      [8, BLUE, RED],
    ])(
      'Exifの向き%iのJPEGは向きを適用した表示上の寸法と画素で描画し、向きの情報を残さない',
      async (orientation, top, bottom) => {
        const stored = await convert(
          await pngOf(1600, 800, leftRedRightBlue(1600)),
          'jpeg',
        );
        const original = withExifOrientation(stored, orientation);
        expect(imageSize(original)).toMatchObject({
          width: 1600,
          height: 800,
          orientation,
        });
        const plan = planFor('image/jpeg', 800, 1600, original);
        expect(plan).toStrictEqual({
          kind: 'resize',
          width: 320,
          height: 640,
          format: 'jpeg',
        });

        const image = await renderOk(original, plan);

        expect(imageSize(image.bytes)).toStrictEqual({
          width: 320,
          height: 640,
          type: 'jpg',
        });
        const decoded = await decode(image.bytes);
        expectNear(pixelAt(decoded, 160, 100), top);
        expectNear(pixelAt(decoded, 160, 540), bottom);
      },
    );
  });

  describe('余白を足す計画', () => {
    test.each<[string, number, number, number, number]>([
      ['横長', 2000, 20, 640, 6],
      ['縦長', 20, 2000, 6, 640],
    ])(
      '極端な%sの画像を縮小し、短辺に白の余白を足して80px以上のPNGにする',
      async (_label, width, height, scaledWidth, scaledHeight) => {
        const original = await pngOf(width, height, () => BLACK);
        const plan = planFor('image/png', width, height, original);
        const canvasWidth = Math.max(scaledWidth, 80);
        const canvasHeight = Math.max(scaledHeight, 80);
        expect(plan).toStrictEqual({
          kind: 'pad',
          width: scaledWidth,
          height: scaledHeight,
          canvasWidth,
          canvasHeight,
        });

        const image = await renderOk(original, plan);

        expect(image.format).toBe('png');
        expect(imageSize(image.bytes)).toStrictEqual({
          width: canvasWidth,
          height: canvasHeight,
          type: 'png',
        });
        const decoded = await decode(image.bytes);
        const left = (canvasWidth - scaledWidth) / 2;
        const top = (canvasHeight - scaledHeight) / 2;
        // 短辺の方向に中央を横切り、縮小した画素の両端と外側の余白を確かめる
        const across =
          scaledHeight < scaledWidth
            ? (offset: number): Rgba =>
                pixelAt(decoded, canvasWidth / 2, top + offset)
            : (offset: number): Rgba =>
                pixelAt(decoded, left + offset, canvasHeight / 2);
        const along =
          scaledHeight < scaledWidth
            ? (offset: number): Rgba => pixelAt(decoded, offset, top)
            : (offset: number): Rgba => pixelAt(decoded, left, offset);
        const shortSide = Math.min(scaledWidth, scaledHeight);
        const longSide = Math.max(scaledWidth, scaledHeight);
        expect(across(-1)).toStrictEqual(WHITE);
        expect(across(0)).toStrictEqual(BLACK);
        expect(across(shortSide - 1)).toStrictEqual(BLACK);
        expect(across(shortSide)).toStrictEqual(WHITE);
        expect(along(0)).toStrictEqual(BLACK);
        expect(along(longSide - 1)).toStrictEqual(BLACK);
      },
    );

    test('小さいSVGを拡大せず、80×80の白の余白の中央に置いたPNGにする', async () => {
      const original = svgOf(30, 10, 'red');
      const plan = planFor('image/svg+xml', 30, 10, original);
      expect(plan).toStrictEqual({
        kind: 'pad',
        width: 30,
        height: 10,
        canvasWidth: 80,
        canvasHeight: 80,
      });

      const image = await renderOk(original, plan);

      expect(imageSize(image.bytes)).toStrictEqual({
        width: 80,
        height: 80,
        type: 'png',
      });
      const decoded = await decode(image.bytes);
      expect(pixelAt(decoded, 25, 35)).toStrictEqual(RED);
      expect(pixelAt(decoded, 54, 44)).toStrictEqual(RED);
      expect(pixelAt(decoded, 24, 35)).toStrictEqual(WHITE);
      expect(pixelAt(decoded, 25, 34)).toStrictEqual(WHITE);
      expect(pixelAt(decoded, 55, 44)).toStrictEqual(WHITE);
      expect(pixelAt(decoded, 54, 45)).toStrictEqual(WHITE);
    });

    test.each<[string, readonly Rgba[], Rgba]>([
      ['赤・青', [RED, BLUE], RED],
      ['青・赤', [BLUE, RED], BLUE],
    ])(
      'GIFアニメーション(%sの順のフレーム)は最初のフレームだけを描画する',
      async (_label, frameColors, firstColor) => {
        const original = animatedGifOf(frameColors);
        const plan = planFor('image/gif', 2, 2, original);
        expect(plan).toStrictEqual({
          kind: 'pad',
          width: 2,
          height: 2,
          canvasWidth: 80,
          canvasHeight: 80,
        });

        const image = await renderOk(original, plan);

        expect(imageSize(image.bytes)).toStrictEqual({
          width: 80,
          height: 80,
          type: 'png',
        });
        const decoded = await decode(image.bytes);
        expect(pixelAt(decoded, 39, 39)).toStrictEqual(firstColor);
        expect(pixelAt(decoded, 40, 40)).toStrictEqual(firstColor);
        expect(pixelAt(decoded, 38, 39)).toStrictEqual(WHITE);
      },
    );
  });

  describe('復号できない画像', () => {
    const RESIZE_PLAN: ModerationImagePlan = {
      kind: 'resize',
      width: 320,
      height: 240,
      format: 'jpeg',
    };
    const PAD_PLAN: ModerationImagePlan = {
      kind: 'pad',
      width: 640,
      height: 6,
      canvasWidth: 640,
      canvasHeight: 80,
    };

    test.each<[string, () => Promise<Uint8Array>]>([
      [
        '形式の分からない本文',
        () => Promise.resolve(Uint8Array.from([1, 2, 3, 4])),
      ],
      ['空の本文', () => Promise.resolve(new Uint8Array(0))],
      [
        '途中で切れたJPEG',
        async () => {
          const jpeg = await convert(await pngOf(64, 48, () => RED), 'jpeg');
          return jpeg.subarray(0, jpeg.length / 2);
        },
      ],
      [
        '途中で切れたPNG',
        async () => (await pngOf(64, 48, () => RED)).subarray(0, 40),
      ],
      [
        '閉じていないSVG',
        () =>
          Promise.resolve(
            new TextEncoder().encode(
              '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect',
            ),
          ),
      ],
    ])(
      '%sは縮小・余白のどちらの計画でも復号できない結果になる',
      async (_label, originalOf) => {
        const original = await originalOf();

        for (const plan of [RESIZE_PLAN, PAD_PLAN]) {
          expect(await renderer().render({ original, plan })).toStrictEqual({
            ok: false,
            reason: 'undecodable',
          });
        }
      },
    );

    test('読み込み以外の失敗は復号できない結果にせず例外のまま投げる', async () => {
      const failure = new Error('Failed to encode image');
      const failing = new WasmModerationImageRenderer(() =>
        Promise.reject(failure),
      );

      await expect(
        failing.render({
          original: await pngOf(2000, 20, () => BLACK),
          plan: PAD_PLAN,
        }),
      ).rejects.toBe(failure);
    });
  });
});
