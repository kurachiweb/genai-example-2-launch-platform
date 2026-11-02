import { describe, expect, test } from 'bun:test';

import { loginHrefFor } from './login-href.ts';

describe('loginHrefFor', () => {
  test('戻り先をクエリのredirectに入れたログイン画面のURLを作る', () => {
    expect(loginHrefFor('/my/products/new')).toBe(
      '/auth/login?redirect=%2Fmy%2Fproducts%2Fnew',
    );
  });

  test('戻り先のクエリとフラグメントの記号も1つの値として符号化する', () => {
    const href = loginHrefFor('/settings/account?tab=email&page=2#top');

    expect(href).toBe(
      '/auth/login?redirect=%2Fsettings%2Faccount%3Ftab%3Demail%26page%3D2%23top',
    );
    expect(
      new URL(href, 'https://client.example').searchParams.get('redirect'),
    ).toBe('/settings/account?tab=email&page=2#top');
  });
});
