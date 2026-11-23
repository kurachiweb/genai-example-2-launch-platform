import { describe, expect, test } from 'bun:test';

import { CsvFormatError, parseCsv, requireColumns } from './csv-source.ts';

describe('parseCsv', () => {
  test('1行目を列名として、各行を列名で引ける記録にする', () => {
    expect(parseCsv('a,b\n1,2\n3,4\n')).toEqual({
      columns: ['a', 'b'],
      records: [
        { a: '1', b: '2' },
        { a: '3', b: '4' },
      ],
      lines: [2, 3],
    });
  });

  test('空行や引用符の中の改行を挟んでも、各記録の開始の行番号を返す', () => {
    expect(parseCsv('a\n\n"x\ny"\n\nz\n').lines).toEqual([3, 6]);
  });

  test('改行コードがCRLFでも読める', () => {
    expect(parseCsv('a,b\r\n1,2\r\n').records).toEqual([{ a: '1', b: '2' }]);
  });

  test('最後の行に改行が無くても読める', () => {
    expect(parseCsv('a\n1').records).toEqual([{ a: '1' }]);
  });

  test('先頭のBOMを列名に含めない', () => {
    expect(parseCsv('﻿a,b\n1,2\n').columns).toEqual(['a', 'b']);
  });

  test('引用符で囲んだ値のカンマ・改行・二重の引用符を読む', () => {
    const text = 'a,b\n"x,y","line1\nline2"\n"say ""hi""",z\n';
    expect(parseCsv(text).records).toEqual([
      { a: 'x,y', b: 'line1\nline2' },
      { a: 'say "hi"', b: 'z' },
    ]);
  });

  test('引用符で囲んだ列名も読める', () => {
    expect(parseCsv('"a,1","b"\n1,2\n').columns).toEqual(['a,1', 'b']);
  });

  test('空の値は空の文字列で返す', () => {
    expect(parseCsv('a,b,c\n1,,3\n,,\n').records).toEqual([
      { a: '1', b: '', c: '3' },
      { a: '', b: '', c: '' },
    ]);
  });

  test('空行は読み飛ばす', () => {
    expect(parseCsv('a\n1\n\n2\n\n').records).toEqual([{ a: '1' }, { a: '2' }]);
  });

  test('日本語・絵文字・SQLの記号を含む値をそのまま読む', () => {
    expect(parseCsv("a\n日本語😀'; DROP\n").records).toEqual([
      { a: "日本語😀'; DROP" },
    ]);
  });

  test('列の数が合わない行は行番号つきで拒否する', () => {
    expect(() => parseCsv('a,b\n1,2\n3\n')).toThrow(CsvFormatError);
    expect(() => parseCsv('a,b\n1,2\n3\n')).toThrow('3行目');
  });

  test('閉じていない引用符を拒否する', () => {
    expect(() => parseCsv('a\n"abc\n')).toThrow('引用符');
  });

  test('引用符の直後に値が続く行を拒否する', () => {
    expect(() => parseCsv('a\n"abc"d\n')).toThrow(CsvFormatError);
  });

  test('空の入力は列名が無いとして拒否する', () => {
    expect(() => parseCsv('')).toThrow('列名');
    expect(() => parseCsv('\n')).toThrow('列名');
  });

  test('列名だけで行が無ければ記録は空になる', () => {
    expect(parseCsv('a,b\n')).toEqual({
      columns: ['a', 'b'],
      records: [],
      lines: [],
    });
  });

  test('1万行を読める', () => {
    const body = Array.from(
      { length: 10_000 },
      (_, i) => `${String(i)},x`,
    ).join('\n');
    expect(parseCsv(`a,b\n${body}\n`).records).toHaveLength(10_000);
  });
});

describe('requireColumns', () => {
  test('全ての列があれば何も投げない', () => {
    expect(() => {
      requireColumns(['a', 'b', 'c'], ['a', 'c']);
    }).not.toThrow();
  });

  test('欠けた列を全て挙げて拒否する', () => {
    expect(() => {
      requireColumns(['a'], ['a', 'x', 'y']);
    }).toThrow('x');
    expect(() => {
      requireColumns(['a'], ['a', 'x', 'y']);
    }).toThrow('y');
  });
});
