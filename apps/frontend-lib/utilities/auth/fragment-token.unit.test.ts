import { describe, expect, test } from 'bun:test';

import { readFragmentToken } from './fragment-token.ts';

const TOKEN = ['Ab3', 'x_9', 'Zq-'].join('');

describe('readFragmentToken', () => {
  test.each([
    ['先頭の#を含むフラグメント', `#token=${TOKEN}`],
    ['先頭の#を含まないフラグメント', `token=${TOKEN}`],
    ['他の値を後ろに持つフラグメント', `#token=${TOKEN}&from=mail`],
    ['他の値を前に持つフラグメント', `#from=mail&token=${TOKEN}`],
  ])('%sからトークンを読む', (_label, hash) => {
    expect(readFragmentToken(hash)).toBe(TOKEN);
  });

  test('パーセント符号化された値を戻して読む', () => {
    expect(readFragmentToken('#token=a%2Db%5Fc')).toBe('a-b_c');
  });

  test.each([
    ['空のフラグメント', ''],
    ['#だけのフラグメント', '#'],
    ['値が空のトークン', '#token='],
    ['トークンを持たないフラグメント', '#section-2'],
    ['名前の異なる値', '#tokens=abc'],
  ])('%sではトークンが無いとする', (_label, hash) => {
    expect(readFragmentToken(hash)).toBeUndefined();
  });
});
