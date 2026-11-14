import { describe, expect, test } from 'bun:test';

import {
  IMAGE_CACHE_CONTROL,
  IMAGE_VARIANTS,
  type ImageVariantName,
} from '../../../common-lib/media/image-variants.ts';
import { NOT_FOUND_RESPONSE } from '../../../lib/core/errors/error-envelope.ts';
import { deliverImage, SVG_CONTENT_SECURITY_POLICY } from './image-delivery.ts';
import type {
  ImageSource,
  ImageTransformer,
  ImageTransformResult,
  SourceImage,
} from './ports.ts';

const OBJECT_KEY = '0123456789abcdef'.repeat(2);

const ORIGIN = 'https://images.test.example';

const ORIGINAL_BYTES = new TextEncoder().encode('original-image');

const TRANSFORMED_BYTES = new TextEncoder().encode('transformed-image');

const SVG_BYTES = new TextEncoder().encode(
  '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>',
);

const VARIANT_NAMES = Object.keys(IMAGE_VARIANTS) as ImageVariantName[];

const RASTER_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
] as const;

interface TrackedBody {
  readonly stream: ReadableStream<Uint8Array>;
  readonly cancelled: () => boolean;
}

const trackedBody = (bytes: Uint8Array): TrackedBody => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
    cancel() {
      cancelled = true;
    },
  });
  return { stream, cancelled: () => cancelled };
};

interface FakeSource extends ImageSource {
  readonly requestedKeys: readonly string[];
  readonly bodyCancelled: () => boolean;
}

const fakeSource = (
  original: { bytes: Uint8Array; contentType: string | undefined } | undefined,
): FakeSource => {
  const requestedKeys: string[] = [];
  let body: TrackedBody | undefined;
  return {
    requestedKeys,
    bodyCancelled: () => body?.cancelled() ?? false,
    get(objectKey): Promise<SourceImage | undefined> {
      requestedKeys.push(objectKey);
      if (original === undefined) {
        return Promise.resolve(undefined);
      }
      body = trackedBody(original.bytes);
      return Promise.resolve({
        body: body.stream,
        contentType: original.contentType,
      });
    },
  };
};

type TransformInput = Parameters<ImageTransformer['transform']>[0];

interface FakeTransformer extends ImageTransformer {
  readonly inputs: readonly Omit<TransformInput, 'body'>[];
  readonly receivedBodies: readonly Uint8Array[];
}

const fakeTransformer = (
  result: (input: TransformInput) => ImageTransformResult = (input) => ({
    ok: true,
    body: trackedBody(TRANSFORMED_BYTES).stream,
    contentType: input.format,
  }),
): FakeTransformer => {
  const inputs: Omit<TransformInput, 'body'>[] = [];
  const receivedBodies: Uint8Array[] = [];
  return {
    inputs,
    receivedBodies,
    async transform(input) {
      const { body, ...rest } = input;
      inputs.push(rest);
      receivedBodies.push(await new Response(body).bytes());
      return result(input);
    },
  };
};

const imageRequest = (
  path: string,
  init: RequestInit = { method: 'GET' },
): Request => new Request(`${ORIGIN}${path}`, init);

const rasterSource = (contentType = 'image/png'): FakeSource =>
  fakeSource({ bytes: ORIGINAL_BYTES, contentType });

const svgSource = (): FakeSource =>
  fakeSource({ bytes: SVG_BYTES, contentType: 'image/svg+xml' });

const expectNotFound = async (response: Response): Promise<void> => {
  expect(response.status).toBe(404);
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(await response.json()).toEqual(NOT_FOUND_RESPONSE.body);
};

describe('deliverImage: 画像のURLの解析と原本の有無', () => {
  test.each([
    ['未定義のバリアント', `/${OBJECT_KEY}/square-xl.webp`],
    ['未定義の拡張子', `/${OBJECT_KEY}/square-sm.gif`],
    ['大文字の拡張子', `/${OBJECT_KEY}/square-sm.PNG`],
    ['拡張子の無いバリアント', `/${OBJECT_KEY}/square-sm`],
    ['オブジェクトキーの形式外', '/0123/square-sm.webp'],
  ])('%sは原本を読まずに404を返す', async (_label, path) => {
    const source = rasterSource();
    const transformer = fakeTransformer();

    const response = await deliverImage(imageRequest(path), {
      source,
      transformer,
    });

    await expectNotFound(response);
    expect(source.requestedKeys).toEqual([]);
    expect(transformer.inputs).toEqual([]);
  });

  test('画像用非公開バケットに原本が無ければ404を返す', async () => {
    const source = fakeSource(undefined);
    const transformer = fakeTransformer();

    const response = await deliverImage(
      imageRequest(`/${OBJECT_KEY}/square-md.webp`),
      { source, transformer },
    );

    await expectNotFound(response);
    expect(source.requestedKeys).toEqual([OBJECT_KEY]);
    expect(transformer.inputs).toEqual([]);
  });

  test.each([
    ['形式の無い', undefined],
    ['画像でない形式の', 'application/pdf'],
  ])('%s原本は変換せずに404を返す', async (_label, contentType) => {
    const source = fakeSource({ bytes: ORIGINAL_BYTES, contentType });
    const transformer = fakeTransformer();

    const response = await deliverImage(
      imageRequest(`/${OBJECT_KEY}/square-md.png`),
      { source, transformer },
    );

    await expectNotFound(response);
    expect(transformer.inputs).toEqual([]);
    expect(source.bodyCancelled()).toBe(true);
  });
});

describe('deliverImage: SVG原本', () => {
  test.each(VARIANT_NAMES)(
    '%sのsvgは原本をそのまま、UTF-8のcharset付きの形式とCSPと長期のキャッシュで返す',
    async (variant) => {
      const transformer = fakeTransformer();

      const response = await deliverImage(
        imageRequest(`/${OBJECT_KEY}/${variant}.svg`),
        { source: svgSource(), transformer },
      );

      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe(
        'image/svg+xml; charset=utf-8',
      );
      expect(response.headers.get('Content-Security-Policy')).toBe(
        SVG_CONTENT_SECURITY_POLICY,
      );
      expect(response.headers.get('Cache-Control')).toBe(IMAGE_CACHE_CONTROL);
      expect(await response.bytes()).toEqual(SVG_BYTES);
      expect(transformer.inputs).toEqual([]);
    },
  );

  test('CSPはトークンの無いsandbox・default-src none・style-srcのインライン・frame-ancestors noneである', () => {
    expect(SVG_CONTENT_SECURITY_POLICY).toBe(
      "sandbox; default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
    );
  });

  test('引数付きのSVGの形式もSVG原本として扱う', async () => {
    const response = await deliverImage(
      imageRequest(`/${OBJECT_KEY}/square-sm.svg`),
      {
        source: fakeSource({
          bytes: SVG_BYTES,
          contentType: 'image/svg+xml; charset=utf-8',
        }),
        transformer: fakeTransformer(),
      },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe(
      'image/svg+xml; charset=utf-8',
    );
  });

  test.each(['avif', 'webp', 'jpg', 'png'])(
    'SVG原本の%sは変換せずに404を返す',
    async (extension) => {
      const source = svgSource();
      const transformer = fakeTransformer();

      const response = await deliverImage(
        imageRequest(`/${OBJECT_KEY}/square-md.${extension}`),
        { source, transformer },
      );

      await expectNotFound(response);
      expect(transformer.inputs).toEqual([]);
      expect(source.bodyCancelled()).toBe(true);
    },
  );
});

describe('deliverImage: ラスター原本の変換', () => {
  test.each([
    ['avif', 'image/avif'],
    ['webp', 'image/webp'],
    ['jpg', 'image/jpeg'],
    ['png', 'image/png'],
  ] as const)(
    '%sは拡張子の形式・品質80・最初のフレームだけで変換する',
    async (extension, format) => {
      const transformer = fakeTransformer();

      const response = await deliverImage(
        imageRequest(`/${OBJECT_KEY}/square-md.${extension}`),
        { source: rasterSource('image/gif'), transformer },
      );

      expect(transformer.inputs).toEqual([
        {
          variant: IMAGE_VARIANTS['square-md'],
          format,
          quality: 80,
          anim: false,
        },
      ]);
      expect(transformer.receivedBodies).toEqual([ORIGINAL_BYTES]);
      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe(format);
      expect(response.headers.get('Cache-Control')).toBe(IMAGE_CACHE_CONTROL);
      expect(response.headers.get('Content-Security-Policy')).toBeNull();
      expect(await response.bytes()).toEqual(TRANSFORMED_BYTES);
    },
  );

  test.each([
    ['square-xs', 32, 'cover'],
    ['square-sm', 64, 'cover'],
    ['square-md', 128, 'cover'],
    ['square-lg', 256, 'cover'],
    ['screenshot-thumb', 480, 'scale-down'],
    ['screenshot-thumb-2x', 960, 'scale-down'],
    ['screenshot-full', 1920, 'scale-down'],
  ] as const)(
    '%sは%ipx四方を上限に%sで変換する',
    async (variant, size, fit) => {
      const transformer = fakeTransformer();

      await deliverImage(imageRequest(`/${OBJECT_KEY}/${variant}.webp`), {
        source: rasterSource(),
        transformer,
      });

      expect(transformer.inputs.map((input) => input.variant)).toEqual([
        { name: variant, width: size, height: size, fit, avif: size <= 1200 },
      ]);
    },
  );

  test.each(RASTER_TYPES)('%sの原本を変換して配信する', async (contentType) => {
    const transformer = fakeTransformer();

    const response = await deliverImage(
      imageRequest(`/${OBJECT_KEY}/screenshot-thumb.png`),
      { source: rasterSource(contentType), transformer },
    );

    expect(response.status).toBe(200);
    expect(transformer.inputs).toHaveLength(1);
  });

  test('変換の結果が示す形式を応答の形式にする', async () => {
    const response = await deliverImage(
      imageRequest(`/${OBJECT_KEY}/square-sm.webp`),
      {
        source: rasterSource(),
        transformer: fakeTransformer(() => ({
          ok: true,
          body: trackedBody(TRANSFORMED_BYTES).stream,
          contentType: 'image/png',
        })),
      },
    );

    expect(response.headers.get('Content-Type')).toBe('image/png');
  });

  test.each(RASTER_TYPES)(
    '%sの原本のsvgは変換せずに404を返す',
    async (contentType) => {
      const source = rasterSource(contentType);
      const transformer = fakeTransformer();

      const response = await deliverImage(
        imageRequest(`/${OBJECT_KEY}/square-md.svg`),
        { source, transformer },
      );

      await expectNotFound(response);
      expect(transformer.inputs).toEqual([]);
      expect(source.bodyCancelled()).toBe(true);
    },
  );

  test('screenshot-fullのavifは変換せずに404を返す', async () => {
    const source = rasterSource();
    const transformer = fakeTransformer();

    const response = await deliverImage(
      imageRequest(`/${OBJECT_KEY}/screenshot-full.avif`),
      { source, transformer },
    );

    await expectNotFound(response);
    expect(transformer.inputs).toEqual([]);
    expect(source.bodyCancelled()).toBe(true);
  });

  test('screenshot-fullのavif以外の形式は変換する', async () => {
    const transformer = fakeTransformer();

    const response = await deliverImage(
      imageRequest(`/${OBJECT_KEY}/screenshot-full.webp`),
      { source: rasterSource(), transformer },
    );

    expect(response.status).toBe(200);
    expect(transformer.inputs).toHaveLength(1);
  });
});

describe('deliverImage: 変換の失敗', () => {
  test('復号できない画像は404を返す', async () => {
    const response = await deliverImage(
      imageRequest(`/${OBJECT_KEY}/square-md.webp`),
      {
        source: rasterSource(),
        transformer: fakeTransformer(() => ({
          ok: false,
          reason: 'invalid-image',
        })),
      },
    );

    await expectNotFound(response);
  });

  test('一時的な失敗は503を再試行までの秒数と共通のエラー形式で返す', async () => {
    const response = await deliverImage(
      imageRequest(`/${OBJECT_KEY}/square-md.webp`),
      {
        source: rasterSource(),
        transformer: fakeTransformer(() => ({
          ok: false,
          reason: 'unavailable',
        })),
      },
    );

    expect(response.status).toBe(503);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Retry-After')).toBe('5');
    expect(await response.json()).toEqual({
      error: {
        code: 'image_unavailable',
        message:
          '現在ご利用いただけません。しばらく待ってから再度お試しください。',
      },
    });
  });

  test('原本の読み出しの例外はそのまま投げる', async () => {
    const failure = new Error('R2の障害');
    const source: ImageSource = { get: () => Promise.reject(failure) };

    const thrown = await deliverImage(
      imageRequest(`/${OBJECT_KEY}/square-md.webp`),
      { source, transformer: fakeTransformer() },
    ).then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(thrown).toBe(failure);
  });
});

describe('deliverImage: 要求による応答の違い', () => {
  test('クエリ文字列と要求ヘッダーで変換の引数と応答のヘッダーが変わらない', async () => {
    const plainTransformer = fakeTransformer();
    const decoratedTransformer = fakeTransformer();

    const plain = await deliverImage(
      imageRequest(`/${OBJECT_KEY}/square-md.webp`),
      { source: rasterSource(), transformer: plainTransformer },
    );
    const decorated = await deliverImage(
      imageRequest(`/${OBJECT_KEY}/square-md.webp?width=2000&format=png`, {
        method: 'GET',
        headers: {
          Accept: 'image/avif,image/webp,*/*',
          Cookie: 'session=example',
          Width: '2000',
        },
      }),
      { source: rasterSource(), transformer: decoratedTransformer },
    );

    expect(decoratedTransformer.inputs).toEqual(plainTransformer.inputs);
    expect([...decorated.headers]).toEqual([...plain.headers]);
    expect(decorated.headers.get('Vary')).toBeNull();
  });

  test('HEADはGETと同じ状態とヘッダーを本文無しで返し、本文の流れを閉じる', async () => {
    const transformed = trackedBody(TRANSFORMED_BYTES);

    const response = await deliverImage(
      imageRequest(`/${OBJECT_KEY}/square-md.webp`, { method: 'HEAD' }),
      {
        source: rasterSource(),
        transformer: fakeTransformer(() => ({
          ok: true,
          body: transformed.stream,
          contentType: 'image/webp',
        })),
      },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/webp');
    expect(response.headers.get('Cache-Control')).toBe(IMAGE_CACHE_CONTROL);
    expect(response.body).toBeNull();
    expect(transformed.cancelled()).toBe(true);
  });

  test('SVG原本へのHEADは本文無しでCSPを付けて返す', async () => {
    const source = svgSource();

    const response = await deliverImage(
      imageRequest(`/${OBJECT_KEY}/square-md.svg`, { method: 'HEAD' }),
      { source, transformer: fakeTransformer() },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Security-Policy')).toBe(
      SVG_CONTENT_SECURITY_POLICY,
    );
    expect(response.body).toBeNull();
    expect(source.bodyCancelled()).toBe(true);
  });

  test('HEADの404は本文無しでno-storeを返す', async () => {
    const response = await deliverImage(
      imageRequest(`/${OBJECT_KEY}/square-xl.webp`, { method: 'HEAD' }),
      { source: rasterSource(), transformer: fakeTransformer() },
    );

    expect(response.status).toBe(404);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.body).toBeNull();
  });
});
