import { describe, expect, test } from 'bun:test';

import { computeCropOutput } from './crop-geometry.ts';

describe('切り取った画像の出力の寸法と形式', () => {
  test('原本がJPEGならJPEGで作り直す', () => {
    expect(
      computeCropOutput({
        area: { width: 100, height: 100 },
        maxLongSide: 256,
        sourceType: 'image/jpeg',
      }).type,
    ).toBe('image/jpeg');
  });

  test.each(['image/png', 'image/gif', 'image/webp'] as const)(
    '原本が%sならPNGで作り直す',
    (sourceType) => {
      expect(
        computeCropOutput({
          area: { width: 100, height: 100 },
          maxLongSide: 256,
          sourceType,
        }).type,
      ).toBe('image/png');
    },
  );

  test('最大寸法以下の範囲は拡大せずそのままの寸法にする', () => {
    expect(
      computeCropOutput({
        area: { width: 200, height: 120 },
        maxLongSide: 256,
        sourceType: 'image/png',
      }),
    ).toEqual({ width: 200, height: 120, type: 'image/png' });
  });

  test('長辺が最大寸法ちょうどの範囲はそのままにする', () => {
    expect(
      computeCropOutput({
        area: { width: 256, height: 256 },
        maxLongSide: 256,
        sourceType: 'image/png',
      }),
    ).toMatchObject({ width: 256, height: 256 });
  });

  test('長辺が最大寸法を超える範囲は、縦横比を保って長辺を最大寸法に縮める', () => {
    expect(
      computeCropOutput({
        area: { width: 4000, height: 3000 },
        maxLongSide: 1920,
        sourceType: 'image/jpeg',
      }),
    ).toEqual({ width: 1920, height: 1440, type: 'image/jpeg' });
    expect(
      computeCropOutput({
        area: { width: 1000, height: 3000 },
        maxLongSide: 1920,
        sourceType: 'image/jpeg',
      }),
    ).toMatchObject({ width: 640, height: 1920 });
  });

  test('小数の範囲は整数の画素に丸め、最大寸法を超えない', () => {
    const output = computeCropOutput({
      area: { width: 1023.6, height: 511.4 },
      maxLongSide: 512,
      sourceType: 'image/png',
    });

    expect(output).toMatchObject({ width: 512, height: 256 });
    expect(Number.isInteger(output.width)).toBe(true);
    expect(Number.isInteger(output.height)).toBe(true);
  });

  test('極端に細長い範囲でも短辺を1画素以上にする', () => {
    expect(
      computeCropOutput({
        area: { width: 10_000, height: 1 },
        maxLongSide: 256,
        sourceType: 'image/png',
      }),
    ).toMatchObject({ width: 256, height: 1 });
  });

  test.each([
    [{ width: 0, height: 10 }, 256],
    [{ width: 10, height: -1 }, 256],
    [{ width: Number.NaN, height: 10 }, 256],
    [{ width: 10, height: 10 }, 0],
    [{ width: 10, height: 10 }, 1.5],
    [{ width: 10, height: 10 }, Number.POSITIVE_INFINITY],
  ])('正でない範囲や整数でない最大寸法は拒否する', (area, maxLongSide) => {
    expect(() =>
      computeCropOutput({ area, maxLongSide, sourceType: 'image/png' }),
    ).toThrow(RangeError);
  });
});
