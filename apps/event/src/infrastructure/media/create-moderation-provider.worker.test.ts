import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, test, vi } from 'vitest';

import type { ModerationImage } from '../../application/media/ports.ts';
import {
  createModerationProvider,
  type EventModerationProviderEnv,
} from './create-moderation-provider.ts';
import { RekognitionModerationProvider } from './rekognition-moderation-provider.ts';
import { StubModerationProvider } from './stub-moderation-provider.ts';

// シークレット検出の誤検知を避けるため、資格情報の形をした値を直書きせずに組み立てる
const ACCESS_KEY_ID = ['factory', 'rekognition', 'access', 'id'].join('-');
const SECRET_ACCESS_KEY = [
  'factory',
  'rekognition',
  'secret',
  'must',
  'not',
  'leak',
].join('-');

const IMAGE: ModerationImage = {
  bytes: Uint8Array.from([1, 2, 3]),
  format: 'png',
};

function createFetcher() {
  const spy = vi.fn<
    (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  >(() => Promise.resolve(Response.json({ ModerationLabels: [] })));
  return spy as typeof spy & typeof fetch;
}

function rekognitionEnv(
  overrides: Partial<EventModerationProviderEnv> = {},
): EventModerationProviderEnv {
  return {
    MODERATION_PROVIDER: 'rekognition',
    MODERATION_REGION: 'us-east-1',
    REKOGNITION_ACCESS_KEY_ID: ACCESS_KEY_ID,
    REKOGNITION_SECRET_ACCESS_KEY: SECRET_ACCESS_KEY,
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('環境の値による判定サービスの実装の選択', () => {
  test('Workers統合テストの環境では外部へ送らない代替の判定を使う', async () => {
    const fetcher = createFetcher();

    const provider = createModerationProvider(env, fetcher);
    await provider.detect(IMAGE, 60);

    expect(provider).toBeInstanceOf(StubModerationProvider);
    expect(fetcher).not.toHaveBeenCalled();
  });

  test('stubなら資格情報があっても外部へ送らない', async () => {
    const fetcher = createFetcher();

    const provider = createModerationProvider(
      rekognitionEnv({ MODERATION_PROVIDER: 'stub' }),
      fetcher,
    );
    await provider.detect(IMAGE, 60);

    expect(provider).toBeInstanceOf(StubModerationProvider);
    expect(fetcher).not.toHaveBeenCalled();
  });

  test.each<[string, EventModerationProviderEnv]>([
    [
      '資格情報が無い',
      { MODERATION_PROVIDER: 'stub', MODERATION_REGION: 'us-east-1' },
    ],
    [
      'リージョンが不正な',
      { MODERATION_PROVIDER: 'stub', MODERATION_REGION: 'example.test/' },
    ],
  ])('stubなら%s設定でも作れる', (_label, providerEnv) => {
    expect(
      createModerationProvider(providerEnv, createFetcher()),
    ).toBeInstanceOf(StubModerationProvider);
  });

  test('rekognitionなら環境のリージョンと資格情報で判定サービスを呼ぶ', async () => {
    const fetcher = createFetcher();

    const provider = createModerationProvider(rekognitionEnv(), fetcher);
    await provider.detect(IMAGE, 60);

    expect(provider).toBeInstanceOf(RekognitionModerationProvider);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [input, init] = fetcher.mock.calls[0] ?? [];
    const request = new Request(input ?? '', init);
    expect(request.url).toBe('https://rekognition.us-east-1.amazonaws.com/');
    expect(request.headers.get('authorization')).toContain(
      `Credential=${ACCESS_KEY_ID}/`,
    );
  });

  test.each<[string, Partial<EventModerationProviderEnv>, readonly string[]]>([
    [
      'アクセスキーIDが無い',
      { REKOGNITION_ACCESS_KEY_ID: undefined },
      ['REKOGNITION_ACCESS_KEY_ID'],
    ],
    [
      'アクセスキーIDが空の',
      { REKOGNITION_ACCESS_KEY_ID: '' },
      ['REKOGNITION_ACCESS_KEY_ID'],
    ],
    [
      '秘密のアクセスキーが無い',
      { REKOGNITION_SECRET_ACCESS_KEY: undefined },
      ['REKOGNITION_SECRET_ACCESS_KEY'],
    ],
    [
      '両方が無い',
      {
        REKOGNITION_ACCESS_KEY_ID: undefined,
        REKOGNITION_SECRET_ACCESS_KEY: '',
      },
      ['REKOGNITION_ACCESS_KEY_ID', 'REKOGNITION_SECRET_ACCESS_KEY'],
    ],
  ])(
    'rekognitionで%s設定は、欠けたキー名だけを示して作成を拒む',
    (_label, overrides, missing) => {
      const create = () =>
        createModerationProvider(rekognitionEnv(overrides), createFetcher());

      expect(create).toThrow(Error);
      let message = '';
      try {
        create();
      } catch (error) {
        message = (error as Error).message;
      }
      for (const name of missing) {
        expect(message).toContain(name);
      }
      expect(message).not.toContain(ACCESS_KEY_ID);
      expect(message).not.toContain(SECRET_ACCESS_KEY);
    },
  );

  test.each([
    '',
    'US-EAST-1',
    'us-east-1.example.test',
    'example.test/',
    'us-east-1/../x',
  ])(
    'rekognitionでリージョンが「%s」の設定は、宛先を組み立てずに作成を拒む',
    (region) => {
      expect(() =>
        createModerationProvider(
          rekognitionEnv({ MODERATION_REGION: region }),
          createFetcher(),
        ),
      ).toThrow('MODERATION_REGION');
    },
  );
});
