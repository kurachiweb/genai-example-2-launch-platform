import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, test } from 'vitest';

import {
  bytesOf,
  clearImageBuckets,
  objectKeyFor,
  putImage,
} from './image-delivery.fixtures.ts';
import { R2ImageSource } from './r2-image-source.ts';

afterEach(async () => {
  await clearImageBuckets();
});

const source = (): R2ImageSource => new R2ImageSource(env.IMAGES_BUCKET);

describe('R2ImageSource', () => {
  test('画像用非公開バケットの原本の本文と形式を返す', async () => {
    const key = objectKeyFor(1);
    await putImage(key, 'original-bytes', 'image/png');

    const original = await source().get(key);

    expect(original?.contentType).toBe('image/png');
    expect(
      new TextDecoder().decode(await bytesOf(original?.body ?? null)),
    ).toBe('original-bytes');
  });

  test('形式の記録が無い原本は形式をundefinedで返す', async () => {
    const key = objectKeyFor(2);
    await putImage(key, 'untyped');

    const original = await source().get(key);

    expect(original?.contentType).toBeUndefined();
    await original?.body.cancel();
  });

  test('原本が無ければundefinedを返す', async () => {
    expect(await source().get(objectKeyFor(3))).toBeUndefined();
  });

  test('隔離バケットにだけある原本は読まない', async () => {
    const key = objectKeyFor(4);
    await env.QUARANTINE_BUCKET.put(key, 'quarantined', {
      httpMetadata: { contentType: 'image/png' },
    });

    expect(await source().get(key)).toBeUndefined();
  });
});
