import { describe, expect, test } from 'bun:test';

import { createKeyedHasher } from '../../../lib/core/crypto/keyed-hasher.ts';
import { hashRateLimitKey } from '../../../lib/core/rate-limit/rate-limit-key.ts';
import { createLoginThrottleKeys } from './login-throttle-keys.ts';

const TEST_PEPPER = 'login-throttle-keys-unit-test-pepper';

const CLIENT_IP = '203.0.113.7';

describe('createLoginThrottleKeys', () => {
  test('前後の空白を除いて小文字にしたメールアドレスと、IPアドレスをそれぞれハッシュ化したキーにする', async () => {
    const hasher = createKeyedHasher(TEST_PEPPER);

    const keys = await createLoginThrottleKeys(
      hasher,
      '  Owner@Launch.EXAMPLE ',
      CLIENT_IP,
    );

    expect(keys).toEqual({
      email: await hashRateLimitKey(hasher, 'owner@launch.example'),
      ip: await hashRateLimitKey(hasher, CLIENT_IP),
    });
  });

  test('大文字小文字や前後の空白だけが異なるメールアドレスは同じキーになる', async () => {
    const hasher = createKeyedHasher(TEST_PEPPER);

    const first = await createLoginThrottleKeys(
      hasher,
      'owner@launch.example',
      CLIENT_IP,
    );
    const second = await createLoginThrottleKeys(
      hasher,
      '\tOWNER@launch.example\n',
      CLIENT_IP,
    );

    expect(second.email).toBe(first.email);
  });

  test('キーに平文のメールアドレスとIPアドレスを含めない', async () => {
    const keys = await createLoginThrottleKeys(
      createKeyedHasher(TEST_PEPPER),
      'owner@launch.example',
      CLIENT_IP,
    );

    expect(keys.email).not.toContain('owner');
    expect(keys.ip).not.toContain(CLIENT_IP);
  });

  test('IPアドレスが不明ならIPのキーを作らず、メールアドレスのキーだけを返す', async () => {
    const hasher = createKeyedHasher(TEST_PEPPER);

    const keys = await createLoginThrottleKeys(
      hasher,
      'owner@launch.example',
      undefined,
    );

    expect(keys).toEqual({
      email: await hashRateLimitKey(hasher, 'owner@launch.example'),
      ip: undefined,
    });
  });

  test('IPアドレスが空文字でも不明として扱い、全員が同じIPのキーを共有しない', async () => {
    const keys = await createLoginThrottleKeys(
      createKeyedHasher(TEST_PEPPER),
      'owner@launch.example',
      '',
    );

    expect(keys.ip).toBeUndefined();
  });
});
