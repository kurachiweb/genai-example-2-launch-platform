import { describe, expect, test } from 'bun:test';

import { resolveClientIp } from './client-ip.ts';

const requestWith = (headers: Record<string, string>): Request =>
  new Request('https://app.example/items', { headers });

describe('resolveClientIp', () => {
  test.each([
    '203.0.113.5',
    '0.0.0.0',
    '255.255.255.255',
    '2001:db8::1',
    '::1',
    '2001:0db8:0000:0000:0000:ff00:0042:8329',
  ])('CF-Connecting-IPの%sをそのまま返す', (ip) => {
    expect(resolveClientIp(requestWith({ 'CF-Connecting-IP': ip }))).toBe(ip);
  });

  test('前後の空白を除いて解釈する', () => {
    expect(
      resolveClientIp(requestWith({ 'CF-Connecting-IP': ' 203.0.113.5 ' })),
    ).toBe('203.0.113.5');
  });

  test('ヘッダー名の大文字小文字を区別しない', () => {
    expect(
      resolveClientIp(requestWith({ 'cf-connecting-ip': '198.51.100.7' })),
    ).toBe('198.51.100.7');
  });

  test('ヘッダーが無ければundefinedを返す', () => {
    expect(resolveClientIp(requestWith({}))).toBeUndefined();
  });

  test.each([
    '',
    'unknown',
    'not-an-ip',
    '256.0.0.1',
    '203.0.113',
    '203.0.113.5.1',
    '203.0.113.5:443',
    '203.0.113.5, 198.51.100.7',
    '[2001:db8::1]',
    '2001:db8::1::2',
    'gggg::1',
  ])('IPとして解釈できない値%pはundefinedを返す', (value) => {
    expect(
      resolveClientIp(requestWith({ 'CF-Connecting-IP': value })),
    ).toBeUndefined();
  });

  test('ブラウザが送ったX-Forwarded-Forや元のクライアントIPの項目は使わない', () => {
    const request = requestWith({
      'X-Forwarded-For': '203.0.113.5',
      'X-Real-IP': '203.0.113.6',
      'x-original-client-ip': '203.0.113.7',
    });

    expect(resolveClientIp(request)).toBeUndefined();
  });
});
