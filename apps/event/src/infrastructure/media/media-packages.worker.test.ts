import { SyntaxValidator } from 'fast-xml-validator';
import { imageSize } from 'image-size';
import { describe, expect, test } from 'vitest';
import { optimizeImage } from 'wasm-image-optimization/workerd';

const PNG_8X4 = Uint8Array.fromBase64(
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAECAIAAAA8r+mnAAAAQUlEQVR4nAXBgQAAMAwDwZCUJCQlCclIQlKh352QGGGxIuKJipOQGWOzJuaZmrNQmOCwIeGFhotQmeKyJeWVlusH7Js4QbMwMQ4AAAAASUVORK5CYII=',
);

const SINGLE_ROOT = { multipleRoots: false } as const;

describe('メディアの検証と判定用画像の変換が使うパッケージ(workerd)', () => {
  test('wasm-image-optimizationがPNGを縦横比を保って縮小し、image-sizeが結果の寸法を読み取る', async () => {
    const result = await optimizeImage({
      image: PNG_8X4,
      width: 4,
      format: 'png',
    });

    expect(result).toMatchObject({
      originalWidth: 8,
      originalHeight: 4,
      width: 4,
      height: 2,
    });
    expect(imageSize(result.data)).toEqual({
      width: 4,
      height: 2,
      type: 'png',
    });
  });

  test('wasm-image-optimizationが縮小した画像を32ビットRGBAの画素で返す', async () => {
    const result = await optimizeImage({
      image: PNG_8X4,
      width: 4,
      format: 'raw',
    });

    expect(result.data.byteLength).toBe(4 * 2 * 4);
  });

  test('fast-xml-validatorが整形式のSVGを受け入れ、閉じていない要素をコード付きのErrorで拒否する', () => {
    expect(
      SyntaxValidator.validate(
        '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1"/></svg>',
        SINGLE_ROOT,
      ),
    ).toBe(true);
    expect(() =>
      SyntaxValidator.validate('<svg><rect></svg>', SINGLE_ROOT),
    ).toThrow(expect.objectContaining({ code: 'InvalidTag' }));
  });
});
