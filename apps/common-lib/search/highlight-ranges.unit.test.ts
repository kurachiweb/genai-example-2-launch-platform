import { Database } from 'bun:sqlite';
import { afterAll, describe, expect, test } from 'bun:test';

import { findHighlightRanges } from './highlight-ranges.ts';
import { normalizeIndexText } from './index-text.ts';
import {
  buildFtsMatchExpression,
  normalizeSearchTerms,
} from './search-terms.ts';

const highlightedSlices = (
  text: string,
  terms: readonly string[],
): readonly string[] =>
  findHighlightRanges(text, terms).map(({ start, end }) =>
    text.slice(start, end),
  );

const graphemeBoundaries = (text: string): ReadonlySet<number> =>
  new Set([
    ...Array.from(
      new Intl.Segmenter('und', { granularity: 'grapheme' }).segment(text),
      ({ index }) => index,
    ),
    text.length,
  ]);

describe('findHighlightRanges', () => {
  test.each([
    ['検索語の配列が空', 'タスク管理', []],
    ['検索語が空文字列と空白だけ', 'タスク管理', ['', ' 　\n']],
    ['表示する文字列が空', '', ['タスク']],
  ])('%sの場合は空を返す', (_, text, terms) => {
    expect(findHighlightRanges(text, terms)).toEqual([]);
  });

  test.each([
    ['大文字小文字', 'Task Manager', ['task', 'MANAGER'], ['Task', 'Manager']],
    ['全角英数字の表示', 'ＴＡＳＫ管理', ['task'], ['ＴＡＳＫ']],
    ['全角英数字の検索語', 'Task123', ['ｔａｓｋ１２'], ['Task12']],
    ['半角カナの表示', 'ﾀｽｸ管理', ['タスク'], ['ﾀｽｸ']],
    ['半角カナの検索語', 'タスク管理', ['ﾀｽｸ'], ['タスク']],
    ['合成済みの発音区別符号', 'Café Olé', ['cafe', 'OLE'], ['Café', 'Olé']],
    ['検索語の発音区別符号', 'cafe', ['café'], ['cafe']],
    ['分解された発音区別符号', 'Cafe\u0301', ['café'], ['Cafe\u0301']],
    ['複数の発音区別符号', 'Việt Nam', ['viet'], ['Việt']],
    [
      '他の結合文字を挟んだ発音区別符号',
      'e\u0301\u0301clair',
      ['e\u094d\u0301'],
      ['e\u0301\u0301'],
    ],
  ])('%sの違いを無視して一致させる', (_, text, terms, expected) => {
    expect(highlightedSlices(text, terms)).toEqual(expected);
  });

  test.each([
    ['CJK文字の語の途中', 'タスク管理ツール', ['管理']],
    ['CJK文字の語の末尾', 'タスク管理ツール', ['ツール']],
    ['英字の語の途中', 'notebook', ['book']],
    ['数字の語の途中', 'v2026', ['2026']],
  ])('%sでは一致しない', (_, text, terms) => {
    expect(findHighlightRanges(text, terms)).toEqual([]);
  });

  test.each([
    ['CJK文字の語', 'タスク管理ツール', ['タスク'], ['タスク']],
    ['記号の後の語', 'e-book', ['book'], ['book']],
    ['中黒の後の語', 'タスク・管理', ['管理'], ['管理']],
    ['絵文字の後の語', '🚀Launch', ['launch'], ['Launch']],
    [
      '語の全体',
      'タスク管理ツール',
      ['タスク管理ツール'],
      ['タスク管理ツール'],
    ],
  ])('%sの先頭から一致させる', (_, text, terms, expected) => {
    expect(highlightedSlices(text, terms)).toEqual(expected);
  });

  test.each([
    ['ハンバーガー', 'パン'],
    ['ガイド', 'カイ'],
    ['ﾊﾟﾝ', 'ハン'],
    ['Ελληνικά', 'ελληνικα'],
    ['йогурт', 'иогурт'],
    ['한국어', '하'],
  ])(
    '濁点・半濁点やラテン文字以外の合成済みの符号を区別する(%sと%s)',
    (text, term) => {
      expect(findHighlightRanges(text, [term])).toEqual([]);
    },
  );

  test.each([
    ['括弧付きの漢字の後の語', '㈱テスト', ['テスト'], ['テスト']],
    ['括弧付きの漢字の中の語', '㈱テスト', ['株'], ['㈱']],
    ['囲み数字の絵文字の後の語', '3️⃣分で始める', ['分'], ['分']],
    ['単位記号の中の語', '20℃の水', ['c'], ['℃']],
    ['括弧付き数字の後の語', '⑴abc', ['abc'], ['abc']],
    ['括弧付き数字の中の語', '⑴abc', ['1'], ['⑴']],
    ['分数の分母から続く語', '¼cup', ['4'], ['¼']],
    ['ゼロ幅接合子の後の語', 'a\u200db', ['b'], ['b']],
    ['合成できない濁点の後の語', 'ア\u3099イ', ['イ'], ['イ']],
    ['デーヴァナーガリーの母音記号の後の語', 'हिन्दी', ['न'], ['न्दी']],
    ['タイ文字の母音記号の後の語', 'กัข', ['ข'], ['ข']],
    [
      'ラテン文字の後の異体字セレクタまでの語',
      'ab\ufe0fc',
      ['ab'],
      ['ab\ufe0f'],
    ],
    ['ラテン文字の後の異体字セレクタの後の語', 'ab\ufe0fc', ['c'], ['c']],
  ])(
    '書記素を折りたたんだ後の文字で語を区切る(%s)',
    (_, text, terms, expected) => {
      expect(highlightedSlices(text, terms)).toEqual(expected);
    },
  );

  test('ラテン文字の後の異体字セレクタを発音区別符号として除かない', () => {
    expect(findHighlightRanges('ab\ufe0fc', ['abc'])).toEqual([]);
  });

  test('検索語を空白で分け、それぞれの語で一致させる', () => {
    expect(highlightedSlices('管理 タスク', ['タスク　管理'])).toEqual([
      '管理',
      'タスク',
    ]);
  });

  test.each([
    ['半角の区切り', 'タスク-管理', 'タスク・管理ツール', ['タスク・管理']],
    ['空白の区切り', 'タスク-管理', 'タスク　管理', ['タスク　管理']],
    ['最後の語の前方一致', 'e-ma', 'e-mail', ['e-ma']],
  ])(
    '記号を含む検索語は区切った語の並びとして一致させる(%s)',
    (_, term, text, expected) => {
      expect(highlightedSlices(text, [term])).toEqual(expected);
    },
  );

  test('記号を含む検索語は区切った語が並んでいない場合に一致しない', () => {
    expect(findHighlightRanges('タスク ツール 管理', ['タスク-管理'])).toEqual(
      [],
    );
  });

  test('記号だけの検索語は一致しない', () => {
    expect(findHighlightRanges('!! # タスク', ['!!', '#'])).toEqual([]);
  });

  test('記号で始まる検索語は記号を除いた語で一致させる', () => {
    expect(highlightedSlices('Rust言語', ['#rust'])).toEqual(['Rust']);
  });

  test('正規化で長さが変わる文字を含む文字列で元の位置を返す', () => {
    const text = 'ｶﾞｲﾄﾞ ﬁle ①番';

    expect(findHighlightRanges(text, ['ガイド'])).toEqual([
      { start: 0, end: 5 },
    ]);
    expect(findHighlightRanges(text, ['file'])).toEqual([{ start: 6, end: 9 }]);
    expect(findHighlightRanges(text, ['1番'])).toEqual([
      { start: 10, end: 12 },
    ]);
  });

  test.each([
    ['合字の途中までの一致', 'ﬁle', 'f', 'ﬁ'],
    ['分解された発音区別符号の前までの一致', 'e\u0301clair', 'e', 'e\u0301'],
    ['肌色の修飾を含む語', 'a👍🏽b', 'a', 'a'],
    ['結合文字を含む半角カナ', 'ﾊﾟﾝ', 'パ', 'ﾊﾟ'],
  ])('範囲を書記素の境界へ広げる(%s)', (_, text, term, expected) => {
    expect(highlightedSlices(text, [term])).toEqual([expected]);
  });

  test.each([
    ['ﾀｽｸｶﾞﾝﾘ ﬁle ①② Café👍🏽Olé e\u0301clair', ['ﾀ', 'f', '1', 'o', 'e']],
    ['タスク管理 タスク・管理 TASK', ['タ', 'タスク', 'タスク-管理', 'task']],
  ])('全ての範囲が書記素の境界にある(%s)', (text, terms) => {
    const boundaries = graphemeBoundaries(text);
    const ranges = findHighlightRanges(text, terms);

    expect(ranges.length).toBeGreaterThan(0);
    for (const { start, end } of ranges) {
      expect(boundaries.has(start)).toBe(true);
      expect(boundaries.has(end)).toBe(true);
      expect(start).toBeLessThan(end);
    }
  });

  test('同じ語の複数の出現をそれぞれ返す', () => {
    expect(findHighlightRanges('タスク タスク', ['タスク'])).toEqual([
      { start: 0, end: 3 },
      { start: 4, end: 7 },
    ]);
  });

  test('範囲を昇順で返す', () => {
    expect(findHighlightRanges('alpha beta', ['beta', 'alpha'])).toEqual([
      { start: 0, end: 5 },
      { start: 6, end: 10 },
    ]);
  });

  test('重なる範囲を1つにまとめる', () => {
    expect(
      findHighlightRanges('タスク管理 タスク・管理', [
        'タス',
        'タスク管',
        '管理',
        'タスク-管',
      ]),
    ).toEqual([
      { start: 0, end: 4 },
      { start: 6, end: 12 },
    ]);
  });

  test('隣り合う範囲を1つにまとめる', () => {
    expect(findHighlightRanges('⑴abc', ['1', 'abc'])).toEqual([
      { start: 0, end: 4 },
    ]);
  });

  test.each([
    ['Cafe\u0301 au lait', ['cafe', 'au']],
    ['ﾀｽｸ管理・ﬁle ①', ['ﾀｽｸ管', 'ＦＩ', '①']],
    ['Việt Nam', ['VIỆ', 'nam']],
  ])(
    '範囲で切り出した部分が検索語と同じ折りたたみで一致する(%s)',
    (text, terms) => {
      const ranges = findHighlightRanges(text, terms);

      expect(ranges.length).toBe(terms.length);
      for (const [index, { start, end }] of ranges.entries()) {
        const slice = text.slice(start, end);
        expect(findHighlightRanges(slice, [terms[index] ?? ''])).toEqual([
          { start: 0, end: slice.length },
        ]);
      }
    },
  );
});

describe('全文検索との一致の規則', () => {
  const database = new Database(':memory:');
  database.run(
    "CREATE VIRTUAL TABLE documents USING fts5(text, tokenize='unicode61 remove_diacritics 2')",
  );
  afterAll(() => {
    database.close();
  });

  const matchesFts = (text: string, term: string): boolean => {
    const expression = buildFtsMatchExpression(normalizeSearchTerms(term));
    if (expression === undefined) {
      return false;
    }
    database.run('DELETE FROM documents');
    database.run('INSERT INTO documents(text) VALUES (?)', [
      normalizeIndexText(text),
    ]);
    return (
      database
        .query('SELECT rowid FROM documents WHERE documents MATCH ?')
        .all(expression).length > 0
    );
  };

  test.each([
    ['タスク管理ツール', 'タスク'],
    ['タスク管理ツール', '管理'],
    ['タスク・管理', '管理'],
    ['タスク・管理ツール', 'タスク-管理'],
    ['タスク ツール 管理', 'タスク-管理'],
    ['notebook', 'book'],
    ['e-book', 'book'],
    ['Task Manager', 'MANAGER'],
    ['ＴＡＳＫ管理', 'task'],
    ['ﾀｽｸ管理', 'タスク'],
    ['ｶﾞｲﾄﾞ', 'カ'],
    ['ﾊﾟﾝ', 'パ'],
    ['ハンバーガー', 'パン'],
    ['ガイド', 'カイ'],
    ['Café Olé', 'ole'],
    ['Việt Nam', 'viet'],
    ['Ελληνικά', 'ελληνικα'],
    ['Ελληνικά', 'ελληνικά'],
    ['йогурт', 'иогурт'],
    ['한국어', '하'],
    ['ﬁle', 'fi'],
    ['①番', '1'],
    ['Rust言語', '#rust'],
    ['!! #', '!!'],
    ['v2026', '2026'],
    ['a_b', 'b'],
    ['㈱テスト', 'テスト'],
    ['㈱テスト', '株'],
    ['3️⃣分で始める', '分'],
    ['20℃の水', 'c'],
    ['⑴abc', 'abc'],
    ['⑴abc', '1'],
    ['¼cup', '4'],
    ['a\u200db', 'b'],
    ['ア\u3099イ', 'イ'],
    ['हिन्दी', 'न'],
    ['กัข', 'ข'],
    ['ab\ufe0fc', 'abc'],
    ['ab\ufe0fc', 'ab'],
    ['ab\ufe0fc', 'c'],
    ['eclair', 'e\u094d\u0301'],
  ])('%sと%sの一致の有無が全文検索と同じになる', (text, term) => {
    expect(findHighlightRanges(text, [term]).length > 0).toBe(
      matchesFts(text, term),
    );
  });
});
