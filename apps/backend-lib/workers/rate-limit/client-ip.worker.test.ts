import { describe, expect, test } from 'vitest';

import { resolveConnectingIp } from './client-ip.ts';

function requestWithHeaders(headers: Record<string, string>): Request {
  return new Request('https://api.launch.example/v1/items', { headers });
}

describe('resolveConnectingIp', () => {
  test('CF-Connecting-IPヘッダーのIPv4アドレスを返す', () => {
    const request = requestWithHeaders({ 'CF-Connecting-IP': '203.0.113.7' });

    expect(resolveConnectingIp(request)).toBe('203.0.113.7');
  });

  test('CF-Connecting-IPヘッダーのIPv6アドレスを返す', () => {
    const request = requestWithHeaders({ 'cf-connecting-ip': '2001:db8::1' });

    expect(resolveConnectingIp(request)).toBe('2001:db8::1');
  });

  test('CF-Connecting-IPヘッダーが無ければundefinedを返す', () => {
    const request = requestWithHeaders({ 'X-Forwarded-For': '203.0.113.8' });

    expect(resolveConnectingIp(request)).toBeUndefined();
  });

  test('CF-Connecting-IPヘッダーが空白だけならundefinedを返す', () => {
    const request = requestWithHeaders({ 'CF-Connecting-IP': '   ' });

    expect(resolveConnectingIp(request)).toBeUndefined();
  });
});
