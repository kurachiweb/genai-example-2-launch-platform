import { describe, expect, test } from 'bun:test';

import {
  directoryCategoryHref,
  myProductEditHref,
  productDetailHref,
  profileHref,
  userMenuLabel,
} from './site-links.ts';

describe('myProductEditHref', () => {
  test('自分のプロダクトの編集画面のパスにする', () => {
    expect(myProductEditHref('pitch-notes')).toBe(
      '/my/products/pitch-notes/edit',
    );
  });
});

describe('directoryCategoryHref', () => {
  test('ディレクトリのパスにカテゴリのハンドルのクエリを付け、値を符号化する', () => {
    expect(directoryCategoryHref('dev-tools')).toBe('/p?category=dev-tools');
    expect(directoryCategoryHref('a&b')).toBe('/p?category=a%26b');
  });
});

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
