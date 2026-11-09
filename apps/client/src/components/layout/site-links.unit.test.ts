import { describe, expect, test } from 'bun:test';

import { productDetailHref, profileHref, userMenuLabel } from './site-links.ts';

describe('profileHref', () => {
  test('ハンドルの前に@を付けたプロフィールのパスにする', () => {
    expect(profileHref('pitch_maker')).toBe('/@pitch_maker');
  });
});

describe('productDetailHref', () => {
  test('ディレクトリのパスの下にプロダクトのハンドルを置いたプロダクト詳細のパスにする', () => {
    expect(productDetailHref('pitch-notes')).toBe('/p/pitch-notes');
  });
});

describe('userMenuLabel', () => {
  test('ニックネームを含めたユーザーメニューの名前にする', () => {
    expect(userMenuLabel('ピッチの作り手')).toBe(
      'ピッチの作り手のユーザーメニュー',
    );
  });
});
