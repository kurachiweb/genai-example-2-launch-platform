import { createExecutionContext } from 'cloudflare:test';
import { env, exports } from 'cloudflare:workers';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { IMAGE_CACHE_CONTROL } from '../../../common-lib/media/image-variants.ts';
import { MEDIA_MESSAGE_LIMITS } from '../../../lib/core/media/media-messages.ts';
import { SVG_CONTENT_SECURITY_POLICY } from '../../application/media/image-delivery.ts';
import type {
  ImageSource,
  ImageTransformer,
} from '../../application/media/ports.ts';
import {
  bytesOf,
  clearImageBuckets,
  objectKeyFor,
  putImage,
} from '../../infrastructure/media/image-delivery.fixtures.ts';
import {
  decode,
  pngOf,
  RED,
} from '../../infrastructure/media/wasm-moderation-image-renderer.fixtures.ts';
import { createImageDeliveryEntrypointClass } from './image-delivery-entrypoint.ts';

const IMAGES_ORIGIN = 'https://images.test.example';

const SVG_ORIGINAL =
  '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="red"/></svg>';

afterEach(async () => {
  vi.restoreAllMocks();
  await clearImageBuckets();
});

const imageUrl = (objectKey: string, file: string): string =>
  `${IMAGES_ORIGIN}/${objectKey}/${file}`;

const keysOf = (count: number): string[] =>
  Array.from({ length: count }, (_, index) => objectKeyFor(index + 1));

// RPCの呼び出しの結果はPromiseと異なる独自のthenableで、expectのrejectsに渡すと拒否が未処理として報告されるため、awaitで受け止める
async function rejectionOf(call: PromiseLike<unknown>): Promise<unknown> {
  try {
    await call;
  } catch (error) {
    return error;
  }
  throw new Error('拒否されませんでした');
}

class InjectedReadFailure extends Error {
  override readonly name = 'InjectedReadFailure';
}

const unusedTransformer: ImageTransformer = {
  transform: () => Promise.reject(new Error('変換は呼ばれない')),
};

function entrypointWith(
  ctx: ExecutionContext,
  source: ImageSource = { get: () => Promise.resolve(undefined) },
): InstanceType<ReturnType<typeof createImageDeliveryEntrypointClass<Env>>> {
  const Entrypoint = createImageDeliveryEntrypointClass<Env>(() => ({
    source,
    transformer: unusedTransformer,
  }));
  return new Entrypoint(ctx, env);
}

// Workers Cacheのある本番の実行コンテキストを再現し、パージの指定を記録する
function contextWithCache(result: CachePurgeResult): {
  readonly ctx: ExecutionContext;
  readonly purged: CachePurgeOptions[];
} {
  const purged: CachePurgeOptions[] = [];
  const ctx = Object.assign(createExecutionContext(), {
    cache: {
      purge: (options: CachePurgeOptions) => {
        purged.push(options);
        return Promise.resolve(result);
      },
    },
  });
  return { ctx, purged };
}

describe('ImageDeliveryのfetch', () => {
  test('ラスター原本をバリアントの寸法と拡張子の形式へ変換して返す', async () => {
    const key = objectKeyFor(1);
    await putImage(key, await pngOf(40, 20, () => RED), 'image/png');

    const response = await exports.ImageDelivery.fetch(
      imageUrl(key, 'square-sm.webp'),
    );
    const decoded = await decode(await bytesOf(response.body));

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/webp');
    expect(response.headers.get('Cache-Control')).toBe(IMAGE_CACHE_CONTROL);
    expect({ width: decoded.width, height: decoded.height }).toEqual({
      width: 64,
      height: 64,
    });
  });

  test('JPEGの拡張子はJPEGで返す', async () => {
    const key = objectKeyFor(2);
    await putImage(key, await pngOf(20, 20, () => RED), 'image/png');

    const response = await exports.ImageDelivery.fetch(
      imageUrl(key, 'square-xs.jpg'),
    );
    await response.body?.cancel();

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/jpeg');
  });

  test('SVG原本は変換せずにSVGのCSPを付けて返す', async () => {
    const key = objectKeyFor(3);
    await putImage(key, SVG_ORIGINAL, 'image/svg+xml');

    const response = await exports.ImageDelivery.fetch(
      imageUrl(key, 'square-md.svg'),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/svg+xml');
    expect(response.headers.get('Content-Security-Policy')).toBe(
      SVG_CONTENT_SECURITY_POLICY,
    );
    expect(response.headers.get('Cache-Control')).toBe(IMAGE_CACHE_CONTROL);
    expect(await response.text()).toBe(SVG_ORIGINAL);
  });

  test('原本が画像用非公開バケットに無ければ404をno-storeで返す', async () => {
    const response = await exports.ImageDelivery.fetch(
      imageUrl(objectKeyFor(4), 'square-sm.webp'),
    );
    await response.body?.cancel();

    expect(response.status).toBe(404);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  test('画像として読めない原本は404をno-storeで返す', async () => {
    const key = objectKeyFor(5);
    await putImage(key, 'broken-image', 'image/png');

    const response = await exports.ImageDelivery.fetch(
      imageUrl(key, 'square-sm.webp'),
    );
    await response.body?.cancel();

    expect(response.status).toBe(404);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  test('想定外の例外はログに出してから投げ直す', async () => {
    const failure = new InjectedReadFailure('原本の読み出しに失敗させる');
    const errorOutput = vi.spyOn(console, 'error').mockImplementation(() => {});
    const entrypoint = entrypointWith(createExecutionContext(), {
      get: () => Promise.reject(failure),
    });

    await expect(
      entrypoint.fetch(
        new Request(imageUrl(objectKeyFor(6), 'square-sm.webp')),
      ),
    ).rejects.toBe(failure);

    const logged = errorOutput.mock.calls
      .map(([record]) => record as Record<string, unknown>)
      .find((record) => record['category'] === 'event.media.delivery');
    expect(logged?.['level']).toBe('error');
    expect(logged?.['error']).toMatchObject({ name: 'InjectedReadFailure' });
  });
});

describe('ImageDeliveryのpurgeObjectKeys', () => {
  test('Workers Cacheの無い環境では上限の件数まで受け付け、省略として成功する', async () => {
    const result = await exports.ImageDelivery.purgeObjectKeys(
      keysOf(MEDIA_MESSAGE_LIMITS.purgeBatch),
    );

    expect(result).toEqual({ ok: true, skipped: true, errorCodes: [] });
  });

  test('上限を超える件数は受け付けない', async () => {
    expect(
      await rejectionOf(
        exports.ImageDelivery.purgeObjectKeys(
          keysOf(MEDIA_MESSAGE_LIMITS.purgeBatch + 1),
        ),
      ),
    ).toBeInstanceOf(RangeError);
  });

  test.each([
    ['空の一覧', []],
    ['オブジェクトキーの形式に合わない値', ['../other']],
  ])('%sは受け付けない', async (_, objectKeys) => {
    expect(
      await rejectionOf(exports.ImageDelivery.purgeObjectKeys(objectKeys)),
    ).toBeInstanceOf(RangeError);
  });

  test('各オブジェクトキーで始まるパスのキャッシュをまとめてパージする', async () => {
    const { ctx, purged } = contextWithCache({ success: true, errors: [] });
    const keys = keysOf(2);

    const result = await entrypointWith(ctx).purgeObjectKeys(keys);

    expect(result).toEqual({ ok: true, skipped: false, errorCodes: [] });
    expect(purged).toEqual([{ pathPrefixes: keys.map((key) => `/${key}/`) }]);
  });

  test('パージが拒否されたらエラーコードを返す', async () => {
    const { ctx } = contextWithCache({
      success: false,
      errors: [{ code: 1134, message: 'rate limited' }],
    });

    const result = await entrypointWith(ctx).purgeObjectKeys(keysOf(1));

    expect(result).toEqual({ ok: false, skipped: false, errorCodes: [1134] });
  });
});
