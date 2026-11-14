import { describe, expect, test } from 'bun:test';

import { createHmac } from 'node:crypto';

import { getLogger } from '@logtape/logtape';

import type { RateLimiter } from '../env/frontend-env.ts';
import { resolveClientIp } from './client-ip.ts';
import {
  checkIpRateLimit,
  IP_RATE_LIMIT,
  type IpRateLimitLogger,
  ipRateLimitKey,
} from './ip-rate-limit.ts';

const CLIENT_IP = '203.0.113.5';
const PEPPER = 'test-pepper-for-ip-rate-limit';
const BASE64URL_86_PATTERN = /^[A-Za-z0-9_-]{86}$/u;

const hashedKeyOf = (rawKey: string): string =>
  createHmac('sha512', PEPPER)
    .update(`rate-limit-key\u0000${JSON.stringify([rawKey])}`)
    .digest('base64url');

interface RecordingLimiter extends RateLimiter {
  readonly keys: readonly string[];
}

const limiterReturning = (success: boolean): RecordingLimiter => {
  const keys: string[] = [];
  return {
    keys,
    limit: ({ key }) => {
      keys.push(key);
      return Promise.resolve({ success });
    },
  };
};

interface WarningRecord {
  readonly message: string;
  readonly properties: Readonly<Record<string, unknown>>;
}

interface RecordingLogger extends IpRateLimitLogger {
  readonly warnings: readonly WarningRecord[];
}

const recordingLogger = (): RecordingLogger => {
  const warnings: WarningRecord[] = [];
  return {
    warnings,
    warn: (message, properties) => {
      warnings.push({ message, properties });
    },
  };
};

describe('IP_RATE_LIMIT', () => {
  test('backend-platformの規約と同じ10秒あたり100回・ip:の接頭辞・unknownを持つ', () => {
    expect(IP_RATE_LIMIT).toEqual({
      limit: 100,
      periodSeconds: 10,
      keyPrefix: 'ip:',
      unknownClient: 'unknown',
    });
  });

  test('凍結されている', () => {
    expect(Object.isFrozen(IP_RATE_LIMIT)).toBe(true);
  });
});

describe('ipRateLimitKey', () => {
  test.each([
    ['203.0.113.5', 'ip:203.0.113.5'],
    ['2001:db8::1', 'ip:2001:db8::1'],
  ])('IPアドレス%sのハッシュ化する前のキーは%sである', (ip, expected) => {
    expect(ipRateLimitKey(ip)).toBe(expected);
  });

  test('IPアドレスが分からなければip:unknownである', () => {
    expect(ipRateLimitKey(undefined)).toBe('ip:unknown');
  });

  test('要求のCookie・経路・クエリはキーに含まれない', () => {
    const request = new Request(
      'https://app.example/items/42?session=query-value',
      {
        headers: {
          'CF-Connecting-IP': CLIENT_IP,
          Cookie: '__Host-test_session=cookie-value',
        },
      },
    );

    expect(ipRateLimitKey(resolveClientIp(request))).toBe(`ip:${CLIENT_IP}`);
  });
});

describe('checkIpRateLimit', () => {
  test('バインディングが許可すれば許可を返し、ip:<IP>をペッパーでハッシュ化したキーで数える', async () => {
    const limiter = limiterReturning(true);
    const logger = recordingLogger();

    const outcome = await checkIpRateLimit(limiter, PEPPER, CLIENT_IP, logger);

    expect(outcome).toEqual({ allowed: true });
    expect(limiter.keys).toEqual([hashedKeyOf(`ip:${CLIENT_IP}`)]);
    expect(logger.warnings).toEqual([]);
  });

  test.each([CLIENT_IP, '2001:db8::1'])(
    'バインディングへ渡すキーは86文字のハッシュ値で、IPアドレス%sもip:の接頭辞も含まない',
    async (clientIp) => {
      const limiter = limiterReturning(true);

      await checkIpRateLimit(limiter, PEPPER, clientIp, recordingLogger());

      const [key] = limiter.keys;
      expect(key).toMatch(BASE64URL_86_PATTERN);
      expect(key).not.toContain(clientIp);
      expect(key).not.toContain('ip:');
    },
  );

  test('送信元IPアドレスが違えば別のキーで数える', async () => {
    const limiter = limiterReturning(true);
    const logger = recordingLogger();

    await checkIpRateLimit(limiter, PEPPER, CLIENT_IP, logger);
    await checkIpRateLimit(limiter, PEPPER, '198.51.100.7', logger);

    expect(new Set(limiter.keys).size).toBe(2);
  });

  test('バインディングが超過を返せば、Retry-Afterの10秒とともに拒否を返す', async () => {
    const limiter = limiterReturning(false);
    const logger = recordingLogger();

    const outcome = await checkIpRateLimit(limiter, PEPPER, CLIENT_IP, logger);

    expect(outcome).toEqual({ allowed: false, retryAfterSeconds: 10 });
    expect(logger.warnings).toEqual([]);
  });

  test('不明な送信元はすべてip:unknownをハッシュ化した1つのキーで数える', async () => {
    const limiter = limiterReturning(true);
    const logger = recordingLogger();

    await checkIpRateLimit(limiter, PEPPER, undefined, logger);
    await checkIpRateLimit(limiter, PEPPER, undefined, logger);

    const unknownKey = hashedKeyOf('ip:unknown');
    expect(limiter.keys).toEqual([unknownKey, unknownKey]);
  });

  test('ハッシュ化が例外になれば、バインディングを呼ばずに例外をそのまま伝える', async () => {
    const limiter = limiterReturning(true);
    const logger = recordingLogger();

    const error: unknown = await checkIpRateLimit(
      limiter,
      '',
      CLIENT_IP,
      logger,
    ).then(
      () => undefined,
      (rejection: unknown) => rejection,
    );

    expect(error).toBeInstanceOf(Error);
    expect(limiter.keys).toEqual([]);
    expect(logger.warnings).toEqual([]);
  });

  test.each([
    [
      '同期の例外',
      (): Promise<{ readonly success: boolean }> => {
        throw new Error('limiter failed');
      },
    ],
    [
      '非同期の失敗',
      (): Promise<{ readonly success: boolean }> =>
        Promise.reject(new Error('limiter failed')),
    ],
  ])('バインディングの%sでは要求を通し、警告を1件出す', async (_, limit) => {
    const logger = recordingLogger();

    const outcome = await checkIpRateLimit(
      { limit },
      PEPPER,
      CLIENT_IP,
      logger,
    );

    expect(outcome).toEqual({ allowed: true });
    expect(logger.warnings).toHaveLength(1);
    expect(logger.warnings[0]?.message).toBeString();
    expect(logger.warnings[0]?.properties['error']).toBeInstanceOf(Error);
  });

  test('警告の属性はerrorだけで、IPアドレス・キー・ペッパーを含めない', async () => {
    const logger = recordingLogger();
    const limit = (): Promise<{ readonly success: boolean }> =>
      Promise.reject(new Error('limiter failed'));

    await checkIpRateLimit({ limit }, PEPPER, CLIENT_IP, logger);

    expect(Object.keys(logger.warnings[0]?.properties ?? {})).toEqual([
      'error',
    ]);
    const serialized = JSON.stringify(logger.warnings);
    expect(serialized).not.toContain(CLIENT_IP);
    expect(serialized).not.toContain(hashedKeyOf(`ip:${CLIENT_IP}`));
    expect(serialized).not.toContain(PEPPER);
  });

  test('LogTapeのロガーをそのまま渡せる', async () => {
    const limit = (): Promise<{ readonly success: boolean }> =>
      Promise.reject(new Error('limiter failed'));

    const outcome = await checkIpRateLimit(
      { limit },
      PEPPER,
      CLIENT_IP,
      getLogger(['frontend-lib-test', 'rate-limit']),
    );

    expect(outcome).toEqual({ allowed: true });
  });
});
