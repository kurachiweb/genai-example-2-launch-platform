import { describe, expect, test } from 'bun:test';

import { profileHref, userMenuLabel } from './site-links.ts';

describe('profileHref', () => {
  test('ハンドルの前に@を付けたプロフィールのパスにする', () => {
    expect(profileHref('pitch_maker')).toBe('/@pitch_maker');
  });
});

describe('userMenuLabel', () => {
  test('ニックネームを含めたユーザーメニューの名前にする', () => {
    expect(userMenuLabel('ピッチの作り手')).toBe(
      'ピッチの作り手のユーザーメニュー',
    );
  });
});
