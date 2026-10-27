import { describe, expect, test } from 'bun:test';

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
  ])('IPアドレス%sのキーは%sである', (ip, expected) => {
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
  test('バインディングが許可すれば許可を返し、ip:<IP>のキーで数える', async () => {
    const limiter = limiterReturning(true);
    const logger = recordingLogger();

    const outcome = await checkIpRateLimit(limiter, CLIENT_IP, logger);

    expect(outcome).toEqual({ allowed: true });
    expect(limiter.keys).toEqual([`ip:${CLIENT_IP}`]);
    expect(logger.warnings).toEqual([]);
  });

  test('バインディングが超過を返せば、Retry-Afterの10秒とともに拒否を返す', async () => {
    const limiter = limiterReturning(false);
    const logger = recordingLogger();

    const outcome = await checkIpRateLimit(limiter, CLIENT_IP, logger);

    expect(outcome).toEqual({ allowed: false, retryAfterSeconds: 10 });
    expect(logger.warnings).toEqual([]);
  });

  test('不明な送信元はすべてip:unknownの1つのキーで数える', async () => {
    const limiter = limiterReturning(true);
    const logger = recordingLogger();

    await checkIpRateLimit(limiter, undefined, logger);
    await checkIpRateLimit(limiter, undefined, logger);

    expect(limiter.keys).toEqual(['ip:unknown', 'ip:unknown']);
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

    const outcome = await checkIpRateLimit({ limit }, CLIENT_IP, logger);

    expect(outcome).toEqual({ allowed: true });
    expect(logger.warnings).toHaveLength(1);
    expect(logger.warnings[0]?.message).toBeString();
    expect(logger.warnings[0]?.properties['error']).toBeInstanceOf(Error);
  });

  test('警告の属性はerrorだけで、IPアドレスとキーを含めない', async () => {
    const logger = recordingLogger();
    const limit = (): Promise<{ readonly success: boolean }> =>
      Promise.reject(new Error('limiter failed'));

    await checkIpRateLimit({ limit }, CLIENT_IP, logger);

    expect(Object.keys(logger.warnings[0]?.properties ?? {})).toEqual([
      'error',
    ]);
    expect(logger.warnings[0]?.message).not.toContain(CLIENT_IP);
    expect(JSON.stringify(logger.warnings)).not.toContain(CLIENT_IP);
  });

  test('LogTapeのロガーをそのまま渡せる', async () => {
    const limit = (): Promise<{ readonly success: boolean }> =>
      Promise.reject(new Error('limiter failed'));

    const outcome = await checkIpRateLimit(
      { limit },
      CLIENT_IP,
      getLogger(['frontend-lib-test', 'rate-limit']),
    );

    expect(outcome).toEqual({ allowed: true });
  });
});
