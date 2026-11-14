import { describe, expect, test } from 'bun:test';

import { createTokenWaiters } from './token-waiters.ts';

const LONG_TIMEOUT_MS = 60_000;

describe('createTokenWaiters', () => {
  test('届いたトークンを、待っている最初の待ちへ渡す', async () => {
    const waiters = createTokenWaiters();
    const waiting = waiters.wait(LONG_TIMEOUT_MS);

    const delivered = waiters.deliver('turnstile-token-1');

    expect(delivered).toBe(true);
    expect(await waiting).toBe('turnstile-token-1');
  });

  test('待ちが無ければトークンを受け取らない', () => {
    const waiters = createTokenWaiters();

    expect(waiters.deliver('turnstile-token-1')).toBe(false);
  });

  test('同じトークンを2つの待ちへ渡さず、次のトークンを次の待ちへ渡す', async () => {
    const waiters = createTokenWaiters();
    const first = waiters.wait(LONG_TIMEOUT_MS);
    const second = waiters.wait(LONG_TIMEOUT_MS);

    waiters.deliver('turnstile-token-1');
    waiters.deliver('turnstile-token-2');

    expect(await first).toBe('turnstile-token-1');
    expect(await second).toBe('turnstile-token-2');
    expect(waiters.deliver('turnstile-token-3')).toBe(false);
  });

  test('上限の時間までにトークンが届かなければundefinedで解決し、後のトークンを受け取らない', async () => {
    const waiters = createTokenWaiters();

    const token = await waiters.wait(1);

    expect(token).toBeUndefined();
    expect(waiters.deliver('turnstile-token-1')).toBe(false);
  });

  test('待ちを解くと、すべての待ちをundefinedで解決する', async () => {
    const waiters = createTokenWaiters();
    const first = waiters.wait(LONG_TIMEOUT_MS);
    const second = waiters.wait(LONG_TIMEOUT_MS);

    waiters.cancelAll();

    expect(await first).toBeUndefined();
    expect(await second).toBeUndefined();
    expect(waiters.deliver('turnstile-token-1')).toBe(false);
  });
});
