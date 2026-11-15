import { env } from 'cloudflare:workers';
import { describe, expect, test } from 'vitest';

import type { MediaLocation } from '../../core/media/media-file.ts';
import type { MediaBucketEnv } from './r2-media-object-store.ts';
import { R2MediaObjectStore } from './r2-media-object-store.ts';

const R2_DELETE_KEYS_LIMIT = 1000;

const PNG_META = { contentType: 'image/png' } as const;

const BUCKETS: Readonly<Record<MediaLocation, R2Bucket>> = {
  images: env.IMAGES_BUCKET,
  files: env.FILES_BUCKET,
  quarantine: env.QUARANTINE_BUCKET,
};

const LOCATIONS: readonly MediaLocation[] = ['images', 'files', 'quarantine'];

const encoder = new TextEncoder();

function newObjectKey(): string {
  return crypto.randomUUID().replaceAll('-', '');
}

function streamOf(...chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

function failingStreamOf(
  prefix: string,
  reason: Error,
): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(prefix));
      controller.error(reason);
    },
  });
}

async function textOf(stream: ReadableStream<Uint8Array>): Promise<string> {
  return new Response(stream).text();
}

async function readStored(
  location: MediaLocation,
  key: string,
): Promise<string | undefined> {
  const object = await BUCKETS[location].get(key);
  return object === null ? undefined : object.text();
}

function createStore(buckets: MediaBucketEnv = env): R2MediaObjectStore {
  return new R2MediaObjectStore(buckets);
}

interface DeleteRecordingBucket {
  readonly bucket: R2Bucket;
  readonly deletedBatchSizes: number[];
}

function recordDeletes(target: R2Bucket): DeleteRecordingBucket {
  const deletedBatchSizes: number[] = [];
  const bucket = new Proxy(target, {
    get(original, property) {
      if (property === 'delete') {
        return async (keys: string | string[]) => {
          deletedBatchSizes.push(Array.isArray(keys) ? keys.length : 1);
          return original.delete(keys);
        };
      }
      const value: unknown = Reflect.get(original, property);
      return typeof value === 'function'
        ? (value as (...args: unknown[]) => unknown).bind(original)
        : value;
    },
  });
  return { bucket, deletedBatchSizes };
}

async function putPlain(
  location: MediaLocation,
  key: string,
  text: string,
  httpMetadata?: R2HTTPMetadata,
): Promise<void> {
  await BUCKETS[location].put(key, text, { httpMetadata });
}

describe('R2MediaObjectStoreの書き込み', () => {
  test.each(LOCATIONS)(
    '%sの保存先へ宣言した長さの本文を書き込み、storedを返す',
    async (location) => {
      const key = newObjectKey();

      const result = await createStore().putIfAbsent(
        location,
        key,
        streamOf('abc', 'de'),
        5,
        PNG_META,
      );

      expect(result).toBe('stored');
      expect(await readStored(location, key)).toBe('abcde');
      for (const other of LOCATIONS.filter((each) => each !== location)) {
        expect(await readStored(other, key)).toBeUndefined();
      }
    },
  );

  test('同じキーへの2回目の書き込みは上書きせずexistsを返す', async () => {
    const store = createStore();
    const key = newObjectKey();
    await store.putIfAbsent('images', key, streamOf('first'), 5, PNG_META);

    const result = await store.putIfAbsent(
      'images',
      key,
      streamOf('second'),
      6,
      { contentType: 'image/gif' },
    );

    expect(result).toBe('exists');
    const stored = await env.IMAGES_BUCKET.get(key);
    expect(await stored?.text()).toBe('first');
    expect(stored?.httpMetadata?.contentType).toBe('image/png');
  });

  test('同じキーへ同時に書き込むと1つだけが保存される', async () => {
    const store = createStore();
    const key = newObjectKey();

    const results = await Promise.all(
      ['aaaa', 'bbbb', 'cccc'].map(async (text) =>
        store.putIfAbsent('files', key, streamOf(text), 4, PNG_META),
      ),
    );

    expect(results.filter((result) => result === 'stored')).toHaveLength(1);
    expect(results.filter((result) => result === 'exists')).toHaveLength(2);
  });

  test.each([
    { name: '本文が宣言より短い', chunks: ['abc'], length: 5 },
    { name: '本文が宣言より長い', chunks: ['abcdefg'], length: 5 },
    {
      name: '大きな本文の途中で宣言を超える',
      chunks: ['a'.repeat(100_000), 'b'.repeat(100_000)],
      length: 150_000,
    },
  ])(
    '$nameと書き込みが失敗し、オブジェクトが残らない',
    async ({ chunks, length }) => {
      const key = newObjectKey();

      await expect(
        createStore().putIfAbsent(
          'images',
          key,
          streamOf(...chunks),
          length,
          PNG_META,
        ),
      ).rejects.toThrow(TypeError);

      expect(await env.IMAGES_BUCKET.head(key)).toBeNull();
    },
  );

  test('本文の流れが失敗すると、その例外のまま失敗し、オブジェクトが残らない', async () => {
    const key = newObjectKey();
    const reason = new RangeError('本文の検査で失敗した');

    await expect(
      createStore().putIfAbsent(
        'files',
        key,
        failingStreamOf('ab', reason),
        5,
        PNG_META,
      ),
    ).rejects.toBe(reason);

    expect(await env.FILES_BUCKET.head(key)).toBeNull();
  });

  test('ファイル用のメタデータをオブジェクトのHTTPメタデータとして保存する', async () => {
    const key = newObjectKey();
    const meta = {
      contentType: 'application/pdf',
      contentDisposition: `attachment; filename="report.pdf"; filename*=UTF-8''report.pdf`,
      cacheControl: 'private, no-store',
    };

    await createStore().putIfAbsent('files', key, streamOf('%PDF-'), 5, meta);

    const stored = await env.FILES_BUCKET.head(key);
    expect(stored?.httpMetadata).toEqual(meta);
  });

  test('任意の項目を省いたメタデータでは、形式だけを保存する', async () => {
    const key = newObjectKey();

    await createStore().putIfAbsent('images', key, streamOf('ab'), 2, PNG_META);

    const stored = await env.IMAGES_BUCKET.head(key);
    expect(stored?.httpMetadata).toEqual({ contentType: 'image/png' });
  });
});

describe('R2MediaObjectStoreの読み出しと存在の確認', () => {
  test('保存先のオブジェクトの本文・バイト数・形式を返す', async () => {
    const key = newObjectKey();
    await putPlain('quarantine', key, 'hello', { contentType: 'image/webp' });

    const object = await createStore().get('quarantine', key);

    expect(object).toMatchObject({ size: 5, contentType: 'image/webp' });
    expect(object === undefined ? undefined : await textOf(object.body)).toBe(
      'hello',
    );
  });

  test('形式の無いオブジェクトはcontentTypeをundefinedで返す', async () => {
    const key = newObjectKey();
    await putPlain('images', key, 'xy');

    const object = await createStore().get('images', key);

    expect(object?.contentType).toBeUndefined();
    await object?.body.cancel();
  });

  test('無いオブジェクトや別の保存先のオブジェクトはundefinedを返す', async () => {
    const key = newObjectKey();
    await putPlain('images', key, 'xy');
    const store = createStore();

    expect(await store.get('files', key)).toBeUndefined();
    expect(await store.get('images', newObjectKey())).toBeUndefined();
  });

  test('existsは保存先にオブジェクトがあるときだけ真を返す', async () => {
    const key = newObjectKey();
    await putPlain('files', key, 'xy');
    const store = createStore();

    expect(await store.exists('files', key)).toBe(true);
    expect(await store.exists('images', key)).toBe(false);
    expect(await store.exists('files', newObjectKey())).toBe(false);
  });
});

describe('R2MediaObjectStoreの削除', () => {
  test('指定した保存先のオブジェクトだけを消し、無いキーを含んでも失敗しない', async () => {
    const kept = newObjectKey();
    const removed = newObjectKey();
    await putPlain('images', kept, 'keep');
    await putPlain('images', removed, 'remove');
    await putPlain('quarantine', removed, 'other bucket');

    await createStore().delete('images', [removed, newObjectKey()]);

    expect(await env.IMAGES_BUCKET.head(removed)).toBeNull();
    expect(await env.IMAGES_BUCKET.head(kept)).not.toBeNull();
    expect(await env.QUARANTINE_BUCKET.head(removed)).not.toBeNull();
  });

  test('1,000件を超えるキーを1,000件ごとに分けて全て消す', async () => {
    const prefix = `${newObjectKey()}/`;
    const keys = Array.from(
      { length: R2_DELETE_KEYS_LIMIT * 2 + 1 },
      (_, index) => `${prefix}${String(index).padStart(4, '0')}`,
    );
    for (let start = 0; start < keys.length; start += 100) {
      await Promise.all(
        keys
          .slice(start, start + 100)
          .map(async (key) => putPlain('files', key, 'x')),
      );
    }
    const { bucket, deletedBatchSizes } = recordDeletes(env.FILES_BUCKET);

    await createStore({ ...env, FILES_BUCKET: bucket }).delete('files', keys);

    expect(deletedBatchSizes).toEqual([
      R2_DELETE_KEYS_LIMIT,
      R2_DELETE_KEYS_LIMIT,
      1,
    ]);
    const remaining = await env.FILES_BUCKET.list({ prefix, limit: 10 });
    expect(remaining.objects).toEqual([]);
  });

  test('キーが空なら削除を呼ばない', async () => {
    const { bucket, deletedBatchSizes } = recordDeletes(env.IMAGES_BUCKET);

    await createStore({ ...env, IMAGES_BUCKET: bucket }).delete('images', []);

    expect(deletedBatchSizes).toEqual([]);
  });
});

describe('R2MediaObjectStoreのバケット間のコピー', () => {
  test('元の本文とHTTPメタデータを目的の保存先へ写し、元を残す', async () => {
    const key = newObjectKey();
    const httpMetadata = {
      contentType: 'image/svg+xml',
      cacheControl: 'private, no-store',
    };
    await putPlain('images', key, '<svg/>', httpMetadata);

    const result = await createStore().copy('images', 'quarantine', key);

    expect(result).toBe('copied');
    const copied = await env.QUARANTINE_BUCKET.get(key);
    expect(await copied?.text()).toBe('<svg/>');
    expect(copied?.httpMetadata).toEqual(httpMetadata);
    expect(await readStored('images', key)).toBe('<svg/>');
  });

  test('目的の保存先に既にあれば上書きせずalready-presentを返す', async () => {
    const key = newObjectKey();
    await putPlain('quarantine', key, 'source');
    await putPlain('images', key, 'already');

    const result = await createStore().copy('quarantine', 'images', key);

    expect(result).toBe('already-present');
    expect(await readStored('images', key)).toBe('already');
  });

  test('元が無ければ目的の保存先へ何も書かずsource-missingを返す', async () => {
    const key = newObjectKey();

    const result = await createStore().copy('quarantine', 'images', key);

    expect(result).toBe('source-missing');
    expect(await env.IMAGES_BUCKET.head(key)).toBeNull();
  });
});
