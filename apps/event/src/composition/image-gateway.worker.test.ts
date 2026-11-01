import { exports } from 'cloudflare:workers';
import { afterEach, describe, expect, test } from 'vitest';

import { IMAGE_CACHE_CONTROL } from '../../common-lib/media/image-variants.ts';
import { NOT_FOUND_RESPONSE } from '../../lib/core/errors/error-envelope.ts';
import { SECURITY_HEADERS } from '../../lib/workers/http/security-headers.ts';
import { SVG_CONTENT_SECURITY_POLICY } from '../application/media/image-delivery.ts';
import {
  bytesOf,
  clearImageBuckets,
  objectKeyFor,
  putImage,
} from '../infrastructure/media/image-delivery.fixtures.ts';
import {
  decode,
  pngOf,
  RED,
} from '../infrastructure/media/wasm-moderation-image-renderer.fixtures.ts';

// Workers統合テストの変数の画像配信のホスト名(専用のホスト)
const IMAGES_ORIGIN = 'https://images.test.example';

const EVENT_ORIGIN = 'https://event.launch.example';

const IP_LIMIT = 100;
const PERIOD_MILLISECONDS = 10_000;
const BURST_MARGIN_MILLISECONDS = 4_000;
const BURST_TEST_TIMEOUT_MILLISECONDS = 30_000;

// 最初の要求でエントリと画像の変換・復号のwasmを読み込むため、カバレッジの計測中は既定の5秒を超えることがある
const FIRST_DELIVERY_TIMEOUT_MILLISECONDS = 30_000;

const SVG_ORIGINAL =
  '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="red"/></svg>';

afterEach(async () => {
  await clearImageBuckets();
});

function fromIp(ip: string, init: RequestInit = {}): RequestInit {
  const headers = new Headers(init.headers);
  headers.set('CF-Connecting-IP', ip);
  return { ...init, headers };
}

// Miniflareのバインディングは壁時計にそろえた10秒の期間で数えるため、連続した要求が期間の切り替わりをまたがないように待つ
async function waitForFreshWindow(): Promise<void> {
  const remaining = PERIOD_MILLISECONDS - (Date.now() % PERIOD_MILLISECONDS);
  if (remaining < BURST_MARGIN_MILLISECONDS) {
    await scheduler.wait(remaining + 100);
  }
}

describe('イベントサーバーの画像配信の関門', () => {
  test(
    '専用のホストの画像のURLは、既定のエクスポートからImageDeliveryの変換された画像になる',
    async () => {
      const key = objectKeyFor(1);
      await putImage(key, await pngOf(40, 20, () => RED), 'image/png');

      const response = await exports.default.fetch(
        `${IMAGES_ORIGIN}/${key}/square-sm.webp`,
        fromIp('203.0.113.40'),
      );
      const decoded = await decode(await bytesOf(response.body));

      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe('image/webp');
      expect(response.headers.get('Cache-Control')).toBe(IMAGE_CACHE_CONTROL);
      expect({ width: decoded.width, height: decoded.height }).toEqual({
        width: 64,
        height: 64,
      });
    },
    FIRST_DELIVERY_TIMEOUT_MILLISECONDS,
  );

  test('クエリ文字列と要求ヘッダーが違っても同じ応答を返す', async () => {
    const key = objectKeyFor(2);
    await putImage(key, await pngOf(20, 20, () => RED), 'image/png');

    const plain = await exports.default.fetch(
      `${IMAGES_ORIGIN}/${key}/square-xs.png`,
      fromIp('203.0.113.41'),
    );
    const varied = await exports.default.fetch(
      `${IMAGES_ORIGIN}/${key}/square-xs.png?format=avif&width=9999`,
      fromIp('203.0.113.41', {
        headers: { Accept: 'image/avif', Cookie: 'session=secret-cookie' },
      }),
    );

    expect(varied.status).toBe(plain.status);
    expect(varied.headers.get('Content-Type')).toBe(
      plain.headers.get('Content-Type'),
    );
    expect(varied.headers.get('Cache-Control')).toBe(IMAGE_CACHE_CONTROL);
    expect(await bytesOf(varied.body)).toStrictEqual(await bytesOf(plain.body));
  });

  test('SVGの応答のCSPはセキュリティヘッダーの付与で置き換わらず、他のセキュリティヘッダーは付く', async () => {
    const key = objectKeyFor(3);
    await putImage(key, SVG_ORIGINAL, 'image/svg+xml');

    const response = await exports.default.fetch(
      `${IMAGES_ORIGIN}/${key}/square-md.svg`,
      fromIp('203.0.113.42'),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/svg+xml');
    expect(response.headers.get('Content-Security-Policy')).toBe(
      SVG_CONTENT_SECURITY_POLICY,
    );
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      expect(response.headers.get(name)).toBe(value);
    }
    expect(await response.text()).toBe(SVG_ORIGINAL);
  });

  test('HEADは本文の無い200を返す', async () => {
    const key = objectKeyFor(4);
    await putImage(key, SVG_ORIGINAL, 'image/svg+xml');

    const response = await exports.default.fetch(
      `${IMAGES_ORIGIN}/${key}/square-md.svg`,
      fromIp('203.0.113.43', { method: 'HEAD' }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/svg+xml');
    expect(await response.text()).toBe('');
  });

  test('原本の無い画像は404・no-storeを返す', async () => {
    const response = await exports.default.fetch(
      `${IMAGES_ORIGIN}/${objectKeyFor(5)}/square-sm.webp`,
      fromIp('203.0.113.44'),
    );
    await response.body?.cancel();

    expect(response.status).toBe(404);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  test('画像のURLへのGET・HEAD以外は405・no-storeを返す', async () => {
    const response = await exports.default.fetch(
      `${IMAGES_ORIGIN}/${objectKeyFor(6)}/square-sm.webp`,
      fromIp('203.0.113.45', { method: 'POST', body: 'x' }),
    );

    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('GET, HEAD');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toMatchObject({
      error: { code: 'method_not_allowed' },
    });
  });

  test('専用のホストの画像のURLの形式に合わない要求は、通常の経路へ進めずに404・no-storeを返す', async () => {
    const response = await exports.default.fetch(
      `${IMAGES_ORIGIN}/internal/email/smoke`,
      fromIp('203.0.113.46', { method: 'POST' }),
    );

    expect(response.status).toBe(404);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toStrictEqual(NOT_FOUND_RESPONSE.body);
  });

  test('画像配信のホスト以外では、画像のURLの形式でも通常の経路の404になる', async () => {
    const key = objectKeyFor(7);
    await putImage(key, SVG_ORIGINAL, 'image/svg+xml');

    const response = await exports.default.fetch(
      `${EVENT_ORIGIN}/${key}/square-md.svg`,
      fromIp('203.0.113.47'),
    );

    expect(response.status).toBe(404);
    expect(response.headers.get('Content-Type')).toContain('application/json');
    expect(await response.json()).toStrictEqual(NOT_FOUND_RESPONSE.body);
  });

  test('画像配信のホスト以外のヘルスチェックは、関門を通っても200を返す', async () => {
    const response = await exports.default.fetch(
      `${EVENT_ORIGIN}/health`,
      fromIp('203.0.113.48'),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toStrictEqual({ status: 'ok' });
  });

  test(
    '画像の要求はIP制限で数えられず、上限を超えて送っても429にならない',
    async () => {
      const ip = '203.0.113.49';
      await waitForFreshWindow();
      const statuses: number[] = [];
      for (let index = 0; index <= IP_LIMIT; index += 1) {
        const response = await exports.default.fetch(
          `${IMAGES_ORIGIN}/${objectKeyFor(8)}/square-sm.webp`,
          fromIp(ip),
        );
        await response.body?.cancel();
        statuses.push(response.status);
      }
      const afterImages = await exports.default.fetch(
        `${EVENT_ORIGIN}/health`,
        fromIp(ip),
      );
      await afterImages.body?.cancel();

      expect(statuses).toHaveLength(IP_LIMIT + 1);
      expect(statuses.every((status) => status === 404)).toBe(true);
      expect(afterImages.status).toBe(200);
    },
    BURST_TEST_TIMEOUT_MILLISECONDS,
  );

  test(
    '専用のホストの画像のURLの形式に合わない要求はIP制限で数える',
    async () => {
      const ip = '203.0.113.50';
      await waitForFreshWindow();
      const statuses: number[] = [];
      for (let index = 0; index <= IP_LIMIT; index += 1) {
        const response = await exports.default.fetch(
          `${IMAGES_ORIGIN}/not-image`,
          fromIp(ip),
        );
        await response.body?.cancel();
        statuses.push(response.status);
      }

      expect(
        statuses.slice(0, IP_LIMIT).every((status) => status === 404),
      ).toBe(true);
      expect(statuses[IP_LIMIT]).toBe(429);
    },
    BURST_TEST_TIMEOUT_MILLISECONDS,
  );
});
