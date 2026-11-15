import { env } from 'cloudflare:workers';
import { describe, expect, test } from 'vitest';

import {
  IMAGE_VARIANTS,
  type ImageVariantSpec,
} from '../../../common-lib/media/image-variants.ts';
import type {
  ImageTransformFormat,
  ImageTransformResult,
} from '../../application/media/ports.ts';
import { animatedGif, bytesOf, streamOf } from './image-delivery.fixtures.ts';
import {
  type ImagesInputBinding,
  ImagesBindingTransformer,
} from './images-binding-transformer.ts';
import {
  BLUE,
  decode,
  type DecodedImage,
  expectNear,
  pixelAt,
  pngOf,
  RED,
} from './wasm-moderation-image-renderer.fixtures.ts';

const QUALITY = 80;

const transformWith = (
  images: ImagesInputBinding,
  original: Uint8Array,
  variant: ImageVariantSpec,
  format: ImageTransformFormat,
): Promise<ImageTransformResult> =>
  new ImagesBindingTransformer(images).transform({
    body: streamOf(original),
    variant,
    format,
    quality: QUALITY,
    anim: false,
  });

async function transformedImage(
  original: Uint8Array,
  variant: ImageVariantSpec,
  format: ImageTransformFormat,
): Promise<{ readonly contentType: string; readonly bytes: Uint8Array }> {
  const result = await transformWith(env.IMAGES, original, variant, format);
  if (!result.ok) {
    throw new Error(`変換に失敗しました: ${result.reason}`);
  }
  return { contentType: result.contentType, bytes: await bytesOf(result.body) };
}

async function decodedOf(
  original: Uint8Array,
  variant: ImageVariantSpec,
): Promise<DecodedImage> {
  const { bytes } = await transformedImage(original, variant, 'image/png');
  return decode(bytes);
}

const latin1Of = (bytes: Uint8Array): string =>
  new TextDecoder('latin1').decode(bytes);

interface RecordedCall {
  readonly transform: unknown;
  readonly output: unknown;
}

class ImagesFailure extends Error {
  override readonly name = 'ImagesFailure';
  readonly code: number;

  constructor(code: number) {
    super(`変換基盤が${String(code)}で拒否した`);
    this.code = code;
  }
}

// 変換の引数を記録し、出力を指定どおりに返すか例外にするImages Bindingの偽物
function fakeImages(outcome: () => Promise<ImageTransformationResult>): {
  readonly images: ImagesInputBinding;
  readonly calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const images: ImagesInputBinding = {
    input: (stream) => {
      void stream.cancel();
      let transform: unknown;
      const handle = {
        transform: (options: unknown) => {
          transform = options;
          return handle;
        },
        output: (options: unknown) => {
          calls.push({ transform, output: options });
          return outcome();
        },
      };
      return handle as unknown as ImageTransformer;
    },
  };
  return { images, calls };
}

const failingWith = (error: unknown) => (): Promise<never> =>
  Promise.reject(error instanceof Error ? error : new Error(String(error)));

describe('ImagesBindingTransformer', () => {
  test('coverのバリアントは寸法どおりに切り取り、拡張子の形式で返す', async () => {
    const original = await pngOf(40, 20, () => RED);

    const { contentType, bytes } = await transformedImage(
      original,
      IMAGE_VARIANTS['square-sm'],
      'image/webp',
    );
    const decoded = await decode(bytes);

    expect(contentType).toBe('image/webp');
    expect({ width: decoded.width, height: decoded.height }).toEqual({
      width: 64,
      height: 64,
    });
  });

  test('scale-downのバリアントは縦横比を保って枠に収め、小さい原本を拡大しない', async () => {
    const large = await decodedOf(
      await pngOf(960, 240, () => RED),
      IMAGE_VARIANTS['screenshot-thumb'],
    );
    const small = await decodedOf(
      await pngOf(100, 50, () => RED),
      IMAGE_VARIANTS['screenshot-thumb'],
    );

    expect({ width: large.width, height: large.height }).toEqual({
      width: 480,
      height: 120,
    });
    expect({ width: small.width, height: small.height }).toEqual({
      width: 100,
      height: 50,
    });
  });

  test.each([
    ['image/avif', 'ftypavif'],
    ['image/webp', 'WEBP'],
    ['image/jpeg', 'ÿØÿ'],
    ['image/png', 'PNG'],
  ] as const)('%sへ変換する', async (format, signature) => {
    const original = await pngOf(8, 8, () => BLUE);

    const { contentType, bytes } = await transformedImage(
      original,
      IMAGE_VARIANTS['square-xs'],
      format,
    );

    expect(contentType).toBe(format);
    expect(latin1Of(bytes.subarray(0, 16))).toContain(signature);
  });

  test('GIFアニメーションは最初のフレームだけの静止画にする', async () => {
    const { bytes } = await transformedImage(
      animatedGif(),
      IMAGE_VARIANTS['square-xs'],
      'image/webp',
    );
    const decoded = await decode(bytes);

    expect(latin1Of(bytes)).not.toContain('ANIM');
    expectNear(pixelAt(decoded, 16, 16), RED);
  });

  test('バリアントの寸法・切り取り方と、形式・品質・アニメーションの指定だけを変換基盤へ渡す', async () => {
    const { images, calls } = fakeImages(failingWith(new ImagesFailure(9412)));

    await transformWith(
      images,
      new Uint8Array([1]),
      IMAGE_VARIANTS['screenshot-full'],
      'image/jpeg',
    );

    expect(calls).toEqual([
      {
        transform: { width: 1920, height: 1920, fit: 'scale-down' },
        output: { format: 'image/jpeg', quality: QUALITY, anim: false },
      },
    ]);
  });

  test('画像として読めない原本はinvalid-imageにする', async () => {
    const result = await transformWith(
      env.IMAGES,
      new TextEncoder().encode('not an image'),
      IMAGE_VARIANTS['square-sm'],
      'image/webp',
    );

    expect(result).toEqual({ ok: false, reason: 'invalid-image' });
  });

  test.each([9412, 9413, 9520, 9522, 9523])(
    '画像そのものの問題を示すコード%iはinvalid-imageにする',
    async (code) => {
      const { images } = fakeImages(failingWith(new ImagesFailure(code)));

      const result = await transformWith(
        images,
        new Uint8Array([1]),
        IMAGE_VARIANTS['square-sm'],
        'image/webp',
      );

      expect(result).toEqual({ ok: false, reason: 'invalid-image' });
    },
  );

  test.each([9402, 9422, 9432, 9504])(
    '変換基盤の一時的な問題や上限を示すコード%iはunavailableにする',
    async (code) => {
      const { images } = fakeImages(failingWith(new ImagesFailure(code)));

      const result = await transformWith(
        images,
        new Uint8Array([1]),
        IMAGE_VARIANTS['square-sm'],
        'image/webp',
      );

      expect(result).toEqual({ ok: false, reason: 'unavailable' });
    },
  );

  test('変換基盤のコードを持たない例外は想定外として投げ直す', async () => {
    const unexpected = new TypeError('想定外の失敗');
    const { images } = fakeImages(failingWith(unexpected));

    await expect(
      transformWith(
        images,
        new Uint8Array([1]),
        IMAGE_VARIANTS['square-sm'],
        'image/webp',
      ),
    ).rejects.toBe(unexpected);
  });
});
