import { describe, expect, test } from 'bun:test';

import { snakeCase } from 'drizzle-orm/sqlite-core';

import {
  searchDocumentColumns,
  searchTextColumn,
} from '../schema/_shared/search-documents.ts';
import {
  defineSearchIndex,
  type SearchIndexDefinition,
} from '../search/search-index-definition.ts';
import {
  renderSearchIndexDropSql,
  renderSearchIndexRebuildSql,
  renderSearchIndexSql,
  renderSearchIndexTriggersSql,
} from '../search/search-index-sql.ts';
import {
  renderRequestedSearchIndexSql,
  runPrintSearchIndexSql,
  SearchIndexSqlRequestError,
} from './print-search-index-sql.ts';

const probeSearchDocuments = snakeCase.table('probe_search_documents', {
  ...searchDocumentColumns(),
  name: searchTextColumn('name'),
});

const otherSearchDocuments = snakeCase.table('other_search_documents', {
  ...searchDocumentColumns(),
  title: searchTextColumn('title'),
});

const probeIndex: SearchIndexDefinition = defineSearchIndex({
  documents: probeSearchDocuments,
  textColumns: [{ column: probeSearchDocuments.name, weight: 10 }],
  keywordsWeight: 1,
});

const otherIndex: SearchIndexDefinition = defineSearchIndex({
  documents: otherSearchDocuments,
  textColumns: [{ column: otherSearchDocuments.title, weight: 3 }],
  keywordsWeight: 1,
});

const definitions = [probeIndex, otherIndex];

const render = (args: readonly string[]) =>
  renderRequestedSearchIndexSql(args, definitions);

const SEPARATOR = '\n--> statement-breakpoint\n';

const USAGE =
  '使い方: bun run db:search-index-sql <索引文書のテーブル名> [--triggers] [--rebuild] | --drop | --recreate';

const captureOutput = () => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    output: {
      stdout: { write: (text: string) => stdout.push(text) },
      stderr: { write: (text: string) => stderr.push(text) },
    },
  };
};

describe('renderRequestedSearchIndexSql', () => {
  test('名前だけを渡すと、その定義の全文検索の索引と3つのトリガーのSQLを返す', () => {
    expect(render(['other_search_documents'])).toBe(
      renderSearchIndexSql(otherIndex),
    );
  });

  test('--triggersで、トリガーを作り直すSQLを返す', () => {
    expect(render(['probe_search_documents', '--triggers'])).toBe(
      renderSearchIndexTriggersSql(probeIndex),
    );
  });

  test('--rebuildで、索引を全件作り直すSQLを返す', () => {
    expect(render(['--rebuild', 'probe_search_documents'])).toBe(
      renderSearchIndexRebuildSql(probeIndex),
    );
  });

  test('--triggersと--rebuildを両方渡すと、指定の順によらずトリガーの作り直しの後に文の区切りを挟んで再構築を続ける', () => {
    const expected = `${renderSearchIndexTriggersSql(probeIndex)}${SEPARATOR}${renderSearchIndexRebuildSql(probeIndex)}`;

    expect(render(['probe_search_documents', '--triggers', '--rebuild'])).toBe(
      expected,
    );
    expect(render(['--rebuild', '--triggers', 'probe_search_documents'])).toBe(
      expected,
    );
  });

  test('--dropで、全文検索の索引と3つのトリガーを消すSQLを返す', () => {
    expect(render(['probe_search_documents', '--drop'])).toBe(
      renderSearchIndexDropSql(probeIndex),
    );
  });

  test('--recreateで、索引とトリガーを消した後に作成文と再構築を文の区切りで続けたSQLを返す', () => {
    expect(render(['--recreate', 'probe_search_documents'])).toBe(
      [
        renderSearchIndexDropSql(probeIndex),
        renderSearchIndexSql(probeIndex),
        renderSearchIndexRebuildSql(probeIndex),
      ].join(SEPARATOR),
    );
  });

  test('--dropと--recreateは、他のオプションと組み合わせると使い方を示す例外にする', () => {
    for (const options of [
      ['--drop', '--rebuild'],
      ['--recreate', '--triggers'],
      ['--drop', '--recreate'],
    ]) {
      expect(() => render(['probe_search_documents', ...options])).toThrow(
        new SearchIndexSqlRequestError(USAGE),
      );
    }
  });

  test('登録されていない名前は、登録済みの名前を添えた例外にする', () => {
    expect(() => render(['missing_search_documents'])).toThrow(
      new SearchIndexSqlRequestError(
        'missing_search_documentsの索引の定義はSEARCH_INDEXESに登録されていません。登録済みの名前: probe_search_documents・other_search_documents',
      ),
    );
  });

  test('集約点が0件なら、登録済みの名前が無いことを伝える', () => {
    expect(() =>
      renderRequestedSearchIndexSql(['probe_search_documents'], []),
    ).toThrow(
      new SearchIndexSqlRequestError(
        'probe_search_documentsの索引の定義はSEARCH_INDEXESに登録されていません。登録済みの名前: (無し)',
      ),
    );
  });

  test('名前が無い・2つ以上ある・未知のオプションがあると、使い方を示す例外にする', () => {
    const usage = USAGE;

    expect(() => render([])).toThrow(new SearchIndexSqlRequestError(usage));
    expect(() => render(['--triggers'])).toThrow(
      new SearchIndexSqlRequestError(usage),
    );
    expect(() =>
      render(['probe_search_documents', 'other_search_documents']),
    ).toThrow(new SearchIndexSqlRequestError(usage));
    expect(() => render(['probe_search_documents', '--unknown'])).toThrow(
      new SearchIndexSqlRequestError(usage),
    );
  });
});

describe('runPrintSearchIndexSql', () => {
  test('SQLの末尾に改行を付けて標準出力へ書き、終了コード0を返す', () => {
    const { stdout, stderr, output } = captureOutput();

    const exitCode = runPrintSearchIndexSql(
      ['probe_search_documents', '--rebuild'],
      definitions,
      output,
    );

    expect(exitCode).toBe(0);
    expect(stdout).toEqual([`${renderSearchIndexRebuildSql(probeIndex)}\n`]);
    expect(stderr).toEqual([]);
  });

  test('引数の誤りは、理由の末尾に改行を付けて標準エラーへ書き、終了コード1を返す', () => {
    const { stdout, stderr, output } = captureOutput();

    const exitCode = runPrintSearchIndexSql([], definitions, output);

    expect(exitCode).toBe(1);
    expect(stdout).toEqual([]);
    expect(stderr).toEqual([`${USAGE}\n`]);
  });
});
