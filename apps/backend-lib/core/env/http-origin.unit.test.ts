import { describe, expect, test } from 'bun:test';

import { isHttpOrigin } from './http-origin.ts';

describe('isHttpOrigin', () => {
  test.each([
    'http://localhost:48044',
    'https://client.example',
    'https://client.example:8443',
  ])('オリジン%sを受け付ける', (value) => {
    expect(isHttpOrigin(value)).toBe(true);
  });

  test.each([
    '',
    'client.example',
    'https://client.example/',
    'https://client.example/app',
    'https://client.example?x=1',
    'https://client.example#fragment',
    'https://user@client.example',
    'HTTPS://CLIENT.EXAMPLE',
    'ftp://client.example',
    'javascript:alert(1)',
  ])('オリジンの形式でない%pを拒否する', (value) => {
    expect(isHttpOrigin(value)).toBe(false);
  });
});
