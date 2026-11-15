import { describe, expect, test } from 'bun:test';

import { countGraphemes } from '../text/graphemes.ts';
import {
  normalizeHelpSearchText,
  normalizeHelpTopQuery,
} from './help-query-rules.ts';

const FAMILY = '👨‍👩‍👧‍👦';

describe('normalizeHelpSearchText', () => {
  test('前後の空白を除いた検索語を返す', () => {
    expect(normalizeHelpSearchText('  料金 プラン　')).toBe('料金 プラン');
  });

  test.each([
    ['空文字列', ''],
    ['半角の空白だけ', '   '],
    ['全角の空白と改行だけ', '　\n\t'],
    ['未指定', undefined],
  ])('%sは検索語が無いものとする', (_, raw) => {
    expect(normalizeHelpSearchText(raw)).toBeUndefined();
  });

  test('50書記素の検索語はそのまま受け取る', () => {
    const q = 'あ'.repeat(50);

    expect(normalizeHelpSearchText(q)).toBe(q);
  });

  test('51書記素の検索語を50書記素へ切り詰める', () => {
    expect(normalizeHelpSearchText('あ'.repeat(51))).toBe('あ'.repeat(50));
  });

  test('前後の空白を除いてから切り詰める', () => {
    expect(normalizeHelpSearchText(`   ${'あ'.repeat(51)}`)).toBe(
      'あ'.repeat(50),
    );
  });

  test('結合文字を含む絵文字を分割せずに書記素の単位で切り詰める', () => {
    const normalized =
      normalizeHelpSearchText(`${'a'.repeat(49)}${FAMILY}${FAMILY}`) ?? '';

    expect(normalized).toBe(`${'a'.repeat(49)}${FAMILY}`);
    expect(countGraphemes(normalized)).toBe(50);
    expect(normalized.isWellFormed()).toBe(true);
  });

  test('切り詰めた末尾に残る空白を除く', () => {
    expect(normalizeHelpSearchText(`${'a'.repeat(49)} bcd`)).toBe(
      'a'.repeat(49),
    );
  });

  test('数として届いた検索語は文字列に戻す', () => {
    expect(normalizeHelpSearchText(2048)).toBe('2048');
  });

  test.each([
    ['null', null],
    ['配列', ['料金']],
    ['オブジェクト', { q: '料金' }],
    ['有限でない数', Number.NaN],
    ['真偽値', true],
  ])('文字列でも数でもない値(%s)は検索語が無いものとする', (_, raw) => {
    expect(normalizeHelpSearchText(raw)).toBeUndefined();
  });
});

describe('normalizeHelpTopQuery', () => {
  test('クエリが無ければ検索語をundefinedとして含める', () => {
    const query = normalizeHelpTopQuery({});

    expect(query).toStrictEqual({ q: undefined });
    expect(Object.keys(query)).toEqual(['q']);
  });

  test('検索語を正規化し、他の項目を残さない', () => {
    expect(
      normalizeHelpTopQuery({ q: `  ${'あ'.repeat(60)} `, page: 2 }),
    ).toStrictEqual({ q: 'あ'.repeat(50) });
  });

  test('空白だけの検索語は未指定と同じにする', () => {
    expect(normalizeHelpTopQuery({ q: '　 ' })).toStrictEqual({
      q: undefined,
    });
  });

  test('数として読み取られた検索語は文字列に戻す', () => {
    expect(normalizeHelpTopQuery({ q: 404 })).toStrictEqual({ q: '404' });
  });
});
