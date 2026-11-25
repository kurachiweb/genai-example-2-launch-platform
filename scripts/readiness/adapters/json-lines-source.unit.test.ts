import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { rejectionOf } from '../test-fixtures/rejection-of.ts';
import {
  JsonSourceError,
  parseJsonRecords,
  readJsonRecords,
  readTextFile,
} from './json-lines-source.ts';

const SOURCE = 'logs.jsonl';

describe('parseJsonRecords', () => {
  test('1行に1つのJSONを持つJSON Linesを行の順に読む', () => {
    const text = '{"a":1}\n{"a":2}\n';

    expect(parseJsonRecords(text, SOURCE)).toStrictEqual([{ a: 1 }, { a: 2 }]);
  });

  test('空行と前後の空白とCRLFの改行を読み飛ばす', () => {
    const text = '\r\n  {"a":1}  \r\n\r\n\t\r\n{"a":2}';

    expect(parseJsonRecords(text, SOURCE)).toStrictEqual([{ a: 1 }, { a: 2 }]);
  });

  test('JSON配列の書き出しを要素の順に読む', () => {
    const text = '[{"a":1},{"a":2}]';

    expect(parseJsonRecords(text, SOURCE)).toStrictEqual([{ a: 1 }, { a: 2 }]);
  });

  test('改行や空白で整形されたJSON配列も読む', () => {
    const text = '\n  [\n    {"a": 1},\n    {"a": 2}\n  ]\n';

    expect(parseJsonRecords(text, SOURCE)).toStrictEqual([{ a: 1 }, { a: 2 }]);
  });

  test('オブジェクトでない要素もそのまま返し、要約かどうかの判定は呼び出し側に任せる', () => {
    expect(parseJsonRecords('[1,"x",null]', SOURCE)).toStrictEqual([
      1,
      'x',
      null,
    ]);
    expect(parseJsonRecords('1\n"x"\nnull', SOURCE)).toStrictEqual([
      1,
      'x',
      null,
    ]);
  });

  test('空の入力は記録が無いものとして空の配列を返す', () => {
    expect(parseJsonRecords('', SOURCE)).toStrictEqual([]);
    expect(parseJsonRecords('\n \r\n', SOURCE)).toStrictEqual([]);
    expect(parseJsonRecords('[]', SOURCE)).toStrictEqual([]);
  });

  test('JSON Linesの行がJSONでなければ、入力の名前と行番号を示して拒否する', () => {
    const text = '{"a":1}\n\nこれはJSONではない\n';

    expect(() => parseJsonRecords(text, SOURCE)).toThrow(JsonSourceError);
    expect(() => parseJsonRecords(text, SOURCE)).toThrow(/logs\.jsonl.*3行目/);
  });

  test('閉じていないJSON配列は入力の名前を示して拒否する', () => {
    expect(() => parseJsonRecords('[{"a":1}', SOURCE)).toThrow(JsonSourceError);
    expect(() => parseJsonRecords('[{"a":1}', SOURCE)).toThrow(/logs\.jsonl/);
  });

  test('1つのJSONの値が複数行に渡るオブジェクトはJSON Linesとして拒否する', () => {
    expect(() => parseJsonRecords('{\n"a":1\n}', SOURCE)).toThrow(
      JsonSourceError,
    );
  });
});

describe('readTextFile と readJsonRecords', () => {
  let directory = '';

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'json-lines-source-'));
  });

  afterAll(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  test('ファイルの内容を文字列として読む', async () => {
    const path = join(directory, 'plain.txt');
    await writeFile(path, '日本語のテキスト\n');

    expect(await readTextFile(path)).toBe('日本語のテキスト\n');
  });

  test('存在しないファイルは、パスを示して拒否する', async () => {
    const path = join(directory, 'missing.txt');

    const error = await rejectionOf(readTextFile(path));

    expect(error).toBeInstanceOf(JsonSourceError);
    expect((error as Error).message).toContain(path);
  });

  test('ファイルのJSON Linesを記録として読む', async () => {
    const path = join(directory, 'run.jsonl');
    await writeFile(path, '{"a":1}\n{"a":2}\n');

    expect(await readJsonRecords(path)).toStrictEqual([{ a: 1 }, { a: 2 }]);
  });

  test('ファイルの内容が不正なら、そのファイルのパスを示して拒否する', async () => {
    const path = join(directory, 'broken.jsonl');
    await writeFile(path, '{"a":1}\nbroken\n');

    const error = await rejectionOf(readJsonRecords(path));

    expect((error as Error).message).toContain(path);
  });

  test('読み込みの関数を差し替えて読める', async () => {
    const records = await readJsonRecords('virtual.json', () =>
      Promise.resolve('[{"a":1}]'),
    );

    expect(records).toStrictEqual([{ a: 1 }]);
  });
});
