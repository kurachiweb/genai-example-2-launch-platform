import { inject, injectable } from 'inversify';

import { PLATFORM_TYPES } from '../../core/di/identifiers.ts';
import type { MediaLocation } from '../../core/media/media-file.ts';
import type {
  MediaObjectStore,
  StoredObject,
  StoredObjectMeta,
} from '../../core/media/ports.ts';
import type { PlatformEnv } from '../env/platform-env.ts';

export type MediaBucketEnv = Pick<
  PlatformEnv,
  'IMAGES_BUCKET' | 'FILES_BUCKET' | 'QUARANTINE_BUCKET'
>;

const DELETE_KEYS_PER_CALL = 1000;

// 条件は書き込みの確定と同時に評価されるため、同じキーへの同時の書き込みも1つだけが成功する
function ifAbsent(): Headers {
  return new Headers({ 'If-None-Match': '*' });
}

// Workersの型定義はR2の本文の要素の型を定めないが、R2の本文はバイト列の塊を流す
function bytesOf(body: ReadableStream): ReadableStream<Uint8Array> {
  return body as ReadableStream<Uint8Array>;
}

@injectable()
export class R2MediaObjectStore implements MediaObjectStore {
  constructor(
    @inject(PLATFORM_TYPES.Env) private readonly buckets: MediaBucketEnv,
  ) {}

  async putIfAbsent(
    location: MediaLocation,
    key: string,
    body: ReadableStream<Uint8Array>,
    length: number,
    meta: StoredObjectMeta,
  ): Promise<'stored' | 'exists'> {
    return this.write(location, key, body, length, {
      contentType: meta.contentType,
      ...(meta.contentDisposition === undefined
        ? {}
        : { contentDisposition: meta.contentDisposition }),
      ...(meta.cacheControl === undefined
        ? {}
        : { cacheControl: meta.cacheControl }),
    });
  }

  async get(
    location: MediaLocation,
    key: string,
  ): Promise<StoredObject | undefined> {
    const object = await this.bucketOf(location).get(key);
    if (object === null) {
      return undefined;
    }
    return {
      body: bytesOf(object.body),
      size: object.size,
      contentType: object.httpMetadata?.contentType,
    };
  }

  async exists(location: MediaLocation, key: string): Promise<boolean> {
    return (await this.bucketOf(location).head(key)) !== null;
  }

  async delete(
    location: MediaLocation,
    keys: readonly string[],
  ): Promise<void> {
    const bucket = this.bucketOf(location);
    for (let start = 0; start < keys.length; start += DELETE_KEYS_PER_CALL) {
      await bucket.delete(keys.slice(start, start + DELETE_KEYS_PER_CALL));
    }
  }

  // R2のWorkers APIにはバケット間のコピーが無いため、元を読み出して上書きしない書き込みで写す
  async copy(
    from: MediaLocation,
    to: MediaLocation,
    key: string,
  ): Promise<'copied' | 'already-present' | 'source-missing'> {
    const source = await this.bucketOf(from).get(key);
    if (source === null) {
      return 'source-missing';
    }
    const result = await this.write(
      to,
      key,
      bytesOf(source.body),
      source.size,
      source.httpMetadata ?? {},
    );
    return result === 'stored' ? 'copied' : 'already-present';
  }

  // FixedLengthStreamを通すと、本文が宣言した長さと食い違ったときに書き込みが例外で失敗し、オブジェクトが残らない
  private async write(
    location: MediaLocation,
    key: string,
    body: ReadableStream<Uint8Array>,
    length: number,
    httpMetadata: R2HTTPMetadata,
  ): Promise<'stored' | 'exists'> {
    const fixed = new FixedLengthStream(length);
    const [stored, piped] = await Promise.allSettled([
      this.bucketOf(location).put(key, fixed.readable, {
        onlyIf: ifAbsent(),
        httpMetadata,
      }),
      body.pipeTo(fixed.writable),
    ]);
    // 本文の流れの失敗は書き込みの失敗も引き起こし、拒否の決着の順序は決まらないため、呼び出し元が原因を見分けられるよう本文側の理由を優先する
    if (piped.status === 'rejected') {
      throw piped.reason;
    }
    if (stored.status === 'rejected') {
      throw stored.reason;
    }
    return stored.value === null ? 'exists' : 'stored';
  }

  private bucketOf(location: MediaLocation): R2Bucket {
    switch (location) {
      case 'images':
        return this.buckets.IMAGES_BUCKET;
      case 'files':
        return this.buckets.FILES_BUCKET;
      case 'quarantine':
        return this.buckets.QUARANTINE_BUCKET;
    }
  }
}
