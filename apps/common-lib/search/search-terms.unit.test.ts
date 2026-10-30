import { Database } from 'bun:sqlite';
import { afterAll, describe, expect, test } from 'bun:test';

import { normalizeIndexText } from './index-text.ts';
import {
  buildFtsMatchExpression,
  normalizeSearchTerms,
} from './search-terms.ts';

describe('normalizeSearchTerms', () => {
  test.each([
    ['全角英数字', 'ＣＡＦＥ１２３', ['CAFE123']],
    ['半角カナ', 'ﾀｽｸｶﾞﾝﾘ', ['タスクガンリ']],
    ['合字と丸付き数字', 'ﬁle①', ['file1']],
  ])('%sをNFKC正規化する', (_, input, expected) => {
    expect(normalizeSearchTerms(input)).toEqual(expected);
  });

  test.each([
    ['半角スペース', 'タスク 管理', ['タスク', '管理']],
    ['全角空白', 'タスク\u3000管理', ['タスク', '管理']],
    ['空白の連続', 'タスク \u3000 \t管理', ['タスク', '管理']],
    ['改行', 'タスク\n管理\r\nツール', ['タスク', '管理', 'ツール']],
    ['ノーブレークスペース', 'タスク\u00a0管理', ['タスク', '管理']],
    ['NEL(U+0085)', 'タスク\u0085管理', ['タスク', '管理']],
  ])('%sで語に分ける', (_, input, expected) => {
    expect(normalizeSearchTerms(input)).toEqual(expected);
  });

  test.each([
    ['語の間', 'タスク\ufeff管理', ['タスク\ufeff管理']],
    ['前後', '\ufeffタスク\ufeff', ['\ufeffタスク\ufeff']],
    ['単独', '\ufeff', ['\ufeff']],
  ])('%sのU+FEFFを空白として扱わない', (_, input, expected) => {
    expect(normalizeSearchTerms(input)).toEqual(expected);
  });

  test('前後の空白による空の語を除く', () => {
    expect(normalizeSearchTerms(' \u3000タスク\u3000管理 \n')).toEqual([
      'タスク',
      '管理',
    ]);
  });

  test.each([
    ['空文字列', ''],
    ['半角スペースだけ', '   '],
    ['全角空白だけ', '\u3000\u3000'],
    ['改行とタブだけ', '\n\t\r\n'],
  ])('%sの場合は語を返さない', (_, input) => {
    expect(normalizeSearchTerms(input)).toEqual([]);
  });

  test('大文字小文字と発音区別符号を変えない', () => {
    expect(normalizeSearchTerms('Café')).toEqual(['Café']);
  });
});

describe('buildFtsMatchExpression', () => {
  test('語が無い場合は検索式を作らない', () => {
    expect(buildFtsMatchExpression([])).toBeUndefined();
  });

  test('1つの語を二重引用符で囲んで前方一致にする', () => {
    expect(buildFtsMatchExpression(['タスク'])).toBe('"タスク"*');
  });

  test('複数の語を半角スペースでAND結合する', () => {
    expect(buildFtsMatchExpression(['タスク', '管理', 'cafe'])).toBe(
      '"タスク"* "管理"* "cafe"*',
    );
  });

  test.each([
    ['語の途中の二重引用符', 'a"b', '"a""b"*'],
    ['二重引用符だけの語', '"', '""""*'],
    ['連続した二重引用符', '""x""', '"""""x"""""*'],
  ])('%sを2つ重ねてエスケープする', (_, term, expected) => {
    expect(buildFtsMatchExpression([term])).toBe(expected);
  });

  test.each([
    ['NOT', '"NOT"*'],
    ['OR', '"OR"*'],
    ['AND', '"AND"*'],
    ['NEAR(a', '"NEAR(a"*'],
    ['name:', '"name:"*'],
    ['{name}:x', '"{name}:x"*'],
    ['-name:x', '"-name:x"*'],
    ['^start', '"^start"*'],
    ['!!!', '"!!!"*'],
    ['*', '"*"*'],
    ['()', '"()"*'],
  ])(
    '演算子・列の指定・記号の語「%s」を引用符の中に入れる',
    (term, expected) => {
      expect(buildFtsMatchExpression([term])).toBe(expected);
    },
  );
});

describe('FTS5での検索式の照合', () => {
  const database = new Database(':memory:');
  database.run(
    "CREATE VIRTUAL TABLE documents_fts USING fts5(name, tagline, tokenize='unicode61 remove_diacritics 2', prefix='2 3')",
  );
  const insertDocument = database.prepare(
    'INSERT INTO documents_fts(rowid, name, tagline) VALUES (?, ?, ?)',
  );
  insertDocument.run(
    1,
    normalizeIndexText('Café Résumé'),
    normalizeIndexText('ＬａｕｎｃｈのＡＰＩ'),
  );
  insertDocument.run(
    2,
    normalizeIndexText('タスク管理ツール'),
    normalizeIndexText('ﾁｰﾑの\u3000進捗を\n共有'),
  );
  const matchDocuments = database.prepare<{ rowid: number }, [string]>(
    'SELECT rowid FROM documents_fts WHERE documents_fts MATCH ? ORDER BY rowid',
  );

  afterAll(() => {
    database.close();
  });

  const searchRowIds = (input: string): readonly number[] => {
    const expression = buildFtsMatchExpression(normalizeSearchTerms(input));
    return expression === undefined
      ? []
      : matchDocuments.all(expression).map(({ rowid }) => rowid);
  };

  test.each([
    ['NOT'],
    ['OR AND NOT'],
    ['NEAR(a b)'],
    ['name: tagline:x'],
    ['{name tagline}:café'],
    ['-name:x'],
    ['^タスク'],
    ['!!!'],
    ['*'],
    ['"'],
    ['a"b'],
    ['"タスク" OR "管理"'],
    ['( ) + - : ^ , . ;'],
    ['＂ＮＯＴ＂\u3000（ａ）'],
    ['🇯🇵 👨‍👩‍👧‍👦'],
    ['\ufeff \u0085NOT\ufeff'],
  ])('検索語「%s」の検索式を構文の誤りにしない', (input) => {
    expect(() => searchRowIds(input)).not.toThrow();
  });

  test('ASCIIの記号を1文字ずつ語にした検索式を構文の誤りにしない', () => {
    const symbols = Array.from({ length: 0x7e - 0x21 + 1 }, (_, offset) =>
      String.fromCharCode(0x21 + offset),
    ).filter((character) => !/[0-9A-Za-z]/.test(character));

    expect(() => searchRowIds(symbols.join(' '))).not.toThrow();
    for (const symbol of symbols) {
      expect(() => searchRowIds(symbol)).not.toThrow();
    }
  });

  test('演算子に当たる語を文字列として照合する', () => {
    expect(searchRowIds('タスク OR Café')).toEqual([]);
    expect(searchRowIds('NOT タスク')).toEqual([]);
  });

  test('各語の前方一致で照合する', () => {
    expect(searchRowIds('タスク')).toEqual([2]);
    expect(searchRowIds('Caf')).toEqual([1]);
  });

  test('全ての語を含む文書だけに一致させる', () => {
    expect(searchRowIds('タスク 進捗')).toEqual([2]);
    expect(searchRowIds('タスク Café')).toEqual([]);
  });

  test.each([
    ['大文字小文字', 'CAFE résumé'],
    ['発音区別符号', 'cafe resume'],
    ['全角英数字', 'ｃａｆｅ\u3000ｌａｕｎｃｈ'],
  ])('%sの違いを無視して照合する', (_, input) => {
    expect(searchRowIds(input)).toEqual([1]);
  });

  test('半角カナと全角カナの違いを無視して照合する', () => {
    expect(searchRowIds('ﾀｽｸ チーム')).toEqual([2]);
  });

  test('語の途中には一致させない', () => {
    expect(searchRowIds('管理')).toEqual([]);
  });

  test('語が無い検索語では検索式を作らない', () => {
    expect(buildFtsMatchExpression(normalizeSearchTerms('\u3000 \n'))).toBe(
      undefined,
    );
  });
});
