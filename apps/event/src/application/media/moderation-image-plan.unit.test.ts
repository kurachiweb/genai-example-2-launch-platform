import { describe, expect, test } from 'bun:test';

import type { ImageMediaType } from '../../../common-lib/media/media-types.ts';
import {
  MODERATION_IMAGE_LIMITS,
  planModerationImage,
} from './moderation-image-plan.ts';
import type { ModerationImagePlan } from './ports.ts';

const MAX_BYTES = 5_242_880;

const plan = (
  type: ImageMediaType,
  width: number,
  height: number,
  byteSize = 1_000,
): ModerationImagePlan =>
  planModerationImage({ type, width, height, byteSize });

const outputSizeOf = (
  result: ModerationImagePlan,
  width: number,
  height: number,
): { readonly width: number; readonly height: number } => {
  switch (result.kind) {
    case 'as-is':
      return { width, height };
    case 'resize':
      return { width: result.width, height: result.height };
    case 'pad':
      return { width: result.canvasWidth, height: result.canvasHeight };
  }
};

describe('MODERATION_IMAGE_LIMITS', () => {
  test('長辺640px・短辺80px・判定サービスの画像のバイト列の最大長5,242,880バイトを持つ', () => {
    expect(MODERATION_IMAGE_LIMITS).toEqual({
      maxLongSide: 640,
      minSide: 80,
      maxBytes: MAX_BYTES,
    });
    expect(Object.isFrozen(MODERATION_IMAGE_LIMITS)).toBe(true);
  });
});

describe('planModerationImage: そのまま送る', () => {
  test.each([
    ['image/jpeg', 'jpeg', 640, 480],
    ['image/jpeg', 'jpeg', 480, 640],
    ['image/png', 'png', 80, 80],
    ['image/png', 'png', 640, 640],
    ['image/png', 'png', 640, 80],
  ] as const)(
    '%sの%d×%dで上限ちょうどのバイト数ならそのまま送る',
    (type, format, width, height) => {
      expect(plan(type, width, height, MAX_BYTES)).toEqual({
        kind: 'as-is',
        format,
      });
    },
  );
});

describe('planModerationImage: 縮小(または縮小せずに変換)', () => {
  test.each([
    ['image/jpeg', 'jpeg'],
    ['image/png', 'png'],
  ] as const)(
    '%sで5,242,881バイトなら同じ寸法のまま原本の形式で作り直す',
    (type, format) => {
      expect(plan(type, 640, 480, MAX_BYTES + 1)).toEqual({
        kind: 'resize',
        width: 640,
        height: 480,
        format,
      });
    },
  );

  test('長辺が641pxのJPEGは縦横比を保って長辺640pxのJPEGに縮小する', () => {
    expect(plan('image/jpeg', 641, 481)).toEqual({
      kind: 'resize',
      width: 640,
      height: 480,
      format: 'jpeg',
    });
  });

  test('縦長で長辺が大きいPNGは高さを640pxにしたPNGに縮小する', () => {
    expect(plan('image/png', 3000, 4000)).toEqual({
      kind: 'resize',
      width: 480,
      height: 640,
      format: 'png',
    });
  });

  test.each(['image/gif', 'image/webp', 'image/svg+xml'] as const)(
    '%sは寸法が範囲内でも同じ寸法のPNGに変換する',
    (type) => {
      expect(plan(type, 400, 300)).toEqual({
        kind: 'resize',
        width: 400,
        height: 300,
        format: 'png',
      });
    },
  );

  test.each(['image/gif', 'image/webp'] as const)(
    '%sで長辺が640pxを超えればPNGに変換して縮小する',
    (type) => {
      expect(plan(type, 1920, 1080)).toEqual({
        kind: 'resize',
        width: 640,
        height: 360,
        format: 'png',
      });
    },
  );

  test('寸法の無いSVG(呼び出し元が640×640を渡す)は640×640のPNGにする', () => {
    expect(
      plan(
        'image/svg+xml',
        MODERATION_IMAGE_LIMITS.maxLongSide,
        MODERATION_IMAGE_LIMITS.maxLongSide,
      ),
    ).toEqual({ kind: 'resize', width: 640, height: 640, format: 'png' });
  });

  test('縮小後の短辺が四捨五入で80pxになるなら余白を足さずに縮小する', () => {
    expect(plan('image/jpeg', 1280, 159)).toEqual({
      kind: 'resize',
      width: 640,
      height: 80,
      format: 'jpeg',
    });
  });
});

describe('planModerationImage: 余白', () => {
  test('縮小後の短辺が79pxなら縮小した画素に余白を足して短辺を80pxにする', () => {
    expect(plan('image/jpeg', 1280, 158)).toEqual({
      kind: 'pad',
      width: 640,
      height: 79,
      canvasWidth: 640,
      canvasHeight: 80,
    });
  });

  test('縮小の要らないPNGの短辺が79pxなら縮小せずに余白だけを足す', () => {
    expect(plan('image/png', 79, 640)).toEqual({
      kind: 'pad',
      width: 79,
      height: 640,
      canvasWidth: 80,
      canvasHeight: 640,
    });
  });

  test('両辺が80px未満なら拡大せずに両辺へ余白を足す', () => {
    expect(plan('image/gif', 50, 30)).toEqual({
      kind: 'pad',
      width: 50,
      height: 30,
      canvasWidth: 80,
      canvasHeight: 80,
    });
  });

  test('寸法の小さいSVGも拡大せずに余白を足す', () => {
    expect(plan('image/svg+xml', 24, 24)).toEqual({
      kind: 'pad',
      width: 24,
      height: 24,
      canvasWidth: 80,
      canvasHeight: 80,
    });
  });

  test('12000×1の横長の画像は1px以上を残して640×1に縮小し、640×80の余白の画像にする', () => {
    expect(plan('image/png', 12_000, 1)).toEqual({
      kind: 'pad',
      width: 640,
      height: 1,
      canvasWidth: 640,
      canvasHeight: 80,
    });
  });

  test('1×12000の縦長の画像は80×640の余白の画像にする', () => {
    expect(plan('image/webp', 1, 12_000)).toEqual({
      kind: 'pad',
      width: 1,
      height: 640,
      canvasWidth: 80,
      canvasHeight: 640,
    });
  });
});

describe('planModerationImage: 極端な縦横比', () => {
  const sides = [1, 2, 3, 7, 79, 80, 81, 159, 160, 639, 640, 641, 1281, 12_000];
  const types: readonly ImageMediaType[] = [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/svg+xml',
  ];
  const cases = types.flatMap((type) =>
    sides.flatMap((width) =>
      sides.map((height) => [type, width, height] as const),
    ),
  );

  test.each(cases)(
    '%sの%d×%dは長辺640px以下・短辺80px以上で、縮小した画素が余白の内側に収まる',
    (type, width, height) => {
      const result = plan(type, width, height);
      const output = outputSizeOf(result, width, height);

      expect(Math.max(output.width, output.height)).toBeLessThanOrEqual(640);
      expect(Math.min(output.width, output.height)).toBeGreaterThanOrEqual(80);
      if (result.kind === 'pad') {
        expect(result.width).toBeGreaterThanOrEqual(1);
        expect(result.height).toBeGreaterThanOrEqual(1);
        expect(result.width).toBeLessThanOrEqual(result.canvasWidth);
        expect(result.height).toBeLessThanOrEqual(result.canvasHeight);
      }
    },
  );
});

describe('planModerationImage: 不正な入力', () => {
  test.each([
    [0, 100, 1_000],
    [100, 0, 1_000],
    [-1, 100, 1_000],
    [100.5, 100, 1_000],
    [Number.NaN, 100, 1_000],
    [Number.POSITIVE_INFINITY, 100, 1_000],
    [100, 100, -1],
    [100, 100, 1.5],
  ])('幅%d・高さ%d・%dバイトは例外になる', (width, height, byteSize) => {
    expect(() =>
      planModerationImage({ type: 'image/png', width, height, byteSize }),
    ).toThrow(RangeError);
  });
});
