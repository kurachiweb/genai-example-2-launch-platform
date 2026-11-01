import { describe, expect, test } from 'vitest';

import {
  type ImageDeliveryHostConfig,
  imageDeliveryHostConfigOf,
  isImageDeliveryRequest,
  matchImageRequest,
} from './image-request-match.ts';

const OBJECT_KEY = '0123456789abcdef'.repeat(2);

const DEDICATED: ImageDeliveryHostConfig = {
  hostname: 'images.launch.example',
  dedicated: true,
};

const SHARED_LOCAL: ImageDeliveryHostConfig = {
  hostname: 'localhost',
  dedicated: false,
};

const match = (url: string, config: ImageDeliveryHostConfig) =>
  matchImageRequest(new URL(url), config);

describe('matchImageRequest', () => {
  test('専用のホストの画像のURLは、クエリ文字列を除いたパスを返す', () => {
    expect(
      match(
        `https://images.launch.example/${OBJECT_KEY}/square-sm.webp?w=9999`,
        DEDICATED,
      ),
    ).toStrictEqual({
      kind: 'image',
      path: `/${OBJECT_KEY}/square-sm.webp`,
    });
  });

  test('画像のURLの形式でバリアント名・拡張子が未定義のものも、画像配信の404に任せる', () => {
    expect(
      match(
        `https://images.launch.example/${OBJECT_KEY}/unknown.gif`,
        DEDICATED,
      ),
    ).toStrictEqual({
      kind: 'image',
      path: `/${OBJECT_KEY}/unknown.gif`,
    });
  });

  test.each([
    ['ルート', '/'],
    ['ヘルスチェック', '/health'],
    ['バリアントの無い原本', `/${OBJECT_KEY}`],
    ['形式の合わないオブジェクトキー', '/not-an-object-key/square-sm.webp'],
    ['階層の深いパス', `/${OBJECT_KEY}/square-sm/extra.webp`],
  ])('専用のホストの%sは拒否の対象にする', (_case, path) => {
    expect(match(`https://images.launch.example${path}`, DEDICATED)).toEqual({
      kind: 'reject-on-dedicated-host',
    });
  });

  test('専用でないホストでは、画像のURLだけを画像配信として扱い、他は通常の経路へ進める', () => {
    expect(
      match(`http://localhost:48043/${OBJECT_KEY}/square-xs.png`, SHARED_LOCAL),
    ).toStrictEqual({
      kind: 'image',
      path: `/${OBJECT_KEY}/square-xs.png`,
    });
    expect(match('http://localhost:48043/health', SHARED_LOCAL)).toEqual({
      kind: 'not-image-host',
    });
    expect(
      match('http://localhost:48043/internal/email/smoke', SHARED_LOCAL),
    ).toEqual({ kind: 'not-image-host' });
  });

  test('画像配信のホスト名と異なるホストは、画像のURLの形式でも通常の経路へ進める', () => {
    for (const config of [DEDICATED, SHARED_LOCAL]) {
      expect(
        match(
          `https://event.launch.example/${OBJECT_KEY}/square-sm.webp`,
          config,
        ),
      ).toEqual({ kind: 'not-image-host' });
    }
  });

  test('設定のホスト名の大文字小文字を区別しない', () => {
    expect(
      match(`https://images.launch.example/${OBJECT_KEY}/square-sm.webp`, {
        hostname: 'Images.Launch.Example',
        dedicated: true,
      }),
    ).toMatchObject({ kind: 'image' });
  });

  test('ホスト名が空の設定は、どの要求も画像配信として扱わない', () => {
    expect(
      match(`https://images.launch.example/${OBJECT_KEY}/square-sm.webp`, {
        hostname: '',
        dedicated: true,
      }),
    ).toEqual({ kind: 'not-image-host' });
  });
});

describe('imageDeliveryHostConfigOf', () => {
  test('専用のホストかどうかは文字列のtrueだけを真とする', () => {
    expect(
      imageDeliveryHostConfigOf({
        IMAGE_DELIVERY_HOSTNAME: 'images.launch.example',
        IMAGE_DELIVERY_DEDICATED_HOST: 'true',
      }),
    ).toStrictEqual({ hostname: 'images.launch.example', dedicated: true });
    expect(
      imageDeliveryHostConfigOf({
        IMAGE_DELIVERY_HOSTNAME: 'localhost',
        IMAGE_DELIVERY_DEDICATED_HOST: 'false',
      }),
    ).toStrictEqual({ hostname: 'localhost', dedicated: false });
  });

  test('環境の検証より前に呼ばれても、欠けたキーをホスト名なし・専用でないものとして読む', () => {
    expect(imageDeliveryHostConfigOf({})).toStrictEqual({
      hostname: '',
      dedicated: false,
    });
  });
});

describe('isImageDeliveryRequest', () => {
  const env = {
    IMAGE_DELIVERY_HOSTNAME: 'images.launch.example',
    IMAGE_DELIVERY_DEDICATED_HOST: 'true',
  };

  test('画像配信のホストの画像のURLだけを真とする', () => {
    expect(
      isImageDeliveryRequest(
        new Request(
          `https://images.launch.example/${OBJECT_KEY}/square-sm.webp`,
        ),
        env,
      ),
    ).toBe(true);
    expect(
      isImageDeliveryRequest(
        new Request('https://images.launch.example/health'),
        env,
      ),
    ).toBe(false);
    expect(
      isImageDeliveryRequest(
        new Request(
          `https://event.launch.example/${OBJECT_KEY}/square-sm.webp`,
        ),
        env,
      ),
    ).toBe(false);
  });

  test('メソッドを問わず真とし、405の応答もIP制限で数えない', () => {
    expect(
      isImageDeliveryRequest(
        new Request(
          `https://images.launch.example/${OBJECT_KEY}/square-sm.webp`,
          { method: 'POST' },
        ),
        env,
      ),
    ).toBe(true);
  });
});
