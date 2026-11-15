import { describe, expect, test } from 'vitest';

import { excludeHostname, excludePath } from './exclusions.ts';

interface TestEnv {
  readonly MEDIA_HOSTNAME: string | undefined;
}

const ENV_WITH_MEDIA_HOSTNAME: TestEnv = {
  MEDIA_HOSTNAME: 'media.launch.example',
};
const ENV_WITHOUT_MEDIA_HOSTNAME: TestEnv = { MEDIA_HOSTNAME: undefined };

function request(url: string, method = 'GET'): Request {
  return new Request(url, { method });
}

describe('excludePath', () => {
  test('接頭辞と一致する経路と、その配下の経路を除外する', () => {
    const exclusion = excludePath<TestEnv>('/webhooks/stripe');

    expect(
      exclusion(
        request('https://event.launch.example/webhooks/stripe'),
        ENV_WITH_MEDIA_HOSTNAME,
      ),
    ).toBe(true);
    expect(
      exclusion(
        request('https://event.launch.example/webhooks/stripe/events?x=1'),
        ENV_WITH_MEDIA_HOSTNAME,
      ),
    ).toBe(true);
  });

  test('接頭辞の途中で区切りの無い経路と、別の経路は除外しない', () => {
    const exclusion = excludePath<TestEnv>('/webhooks/stripe');

    expect(
      exclusion(
        request('https://event.launch.example/webhooks/stripe-other'),
        ENV_WITH_MEDIA_HOSTNAME,
      ),
    ).toBe(false);
    expect(
      exclusion(
        request('https://event.launch.example/health'),
        ENV_WITH_MEDIA_HOSTNAME,
      ),
    ).toBe(false);
  });

  test('末尾がスラッシュの接頭辞は、その配下の経路を除外する', () => {
    const exclusion = excludePath<TestEnv>('/unsubscribe/');

    expect(
      exclusion(
        request('https://event.launch.example/unsubscribe/token-1', 'POST'),
        ENV_WITH_MEDIA_HOSTNAME,
      ),
    ).toBe(true);
  });

  test('メソッドを指定すると、そのメソッドのリクエストだけを除外する', () => {
    const exclusion = excludePath<TestEnv>('/unsubscribe', 'post');

    expect(
      exclusion(
        request('https://event.launch.example/unsubscribe', 'POST'),
        ENV_WITH_MEDIA_HOSTNAME,
      ),
    ).toBe(true);
    expect(
      exclusion(
        request('https://event.launch.example/unsubscribe', 'GET'),
        ENV_WITH_MEDIA_HOSTNAME,
      ),
    ).toBe(false);
  });

  test('スラッシュで始まらない接頭辞はRangeErrorにする', () => {
    expect(() => excludePath<TestEnv>('webhooks/stripe')).toThrow(RangeError);
  });
});

describe('excludeHostname', () => {
  const exclusion = excludeHostname<TestEnv>((env) => env.MEDIA_HOSTNAME);

  test('環境から求めたホスト名宛てのリクエストを除外する', () => {
    expect(
      exclusion(
        request('https://media.launch.example/images/a.webp'),
        ENV_WITH_MEDIA_HOSTNAME,
      ),
    ).toBe(true);
  });

  test('設定値の大文字小文字を区別せずに一致を判定する', () => {
    const upperCaseExclusion = excludeHostname<TestEnv>(
      () => 'MEDIA.Launch.Example',
    );

    expect(
      upperCaseExclusion(
        request('https://media.launch.example/images/a.webp'),
        ENV_WITH_MEDIA_HOSTNAME,
      ),
    ).toBe(true);
  });

  test('別のホスト名宛てのリクエストは除外しない', () => {
    expect(
      exclusion(
        request('https://event.launch.example/images/a.webp'),
        ENV_WITH_MEDIA_HOSTNAME,
      ),
    ).toBe(false);
  });

  test('ホスト名が設定されていなければ除外しない', () => {
    expect(
      exclusion(
        request('https://media.launch.example/images/a.webp'),
        ENV_WITHOUT_MEDIA_HOSTNAME,
      ),
    ).toBe(false);
    expect(
      exclusion(request('https://media.launch.example/images/a.webp'), {
        MEDIA_HOSTNAME: '',
      }),
    ).toBe(false);
  });
});
