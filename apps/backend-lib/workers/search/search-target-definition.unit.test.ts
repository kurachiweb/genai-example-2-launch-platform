import { describe, expect, expectTypeOf, test } from 'bun:test';

import { sql } from 'drizzle-orm';
import { snakeCase } from 'drizzle-orm/sqlite-core';

import {
  searchDocumentColumns,
  searchTextColumn,
} from '../../../db/schema/_shared/search-documents.ts';
import { defineSearchIndex } from '../../../db/search/search-index-definition.ts';
import type { KeywordStatus } from '../../core/search/keyword-status.ts';
import type {
  SearchFieldSpec,
  SearchSource,
} from '../../core/search/search-target.ts';
import {
  createSearchTargetRegistry,
  defineSearchTarget,
  SEARCH_KEYWORD_STATUSES,
  type SearchTargetDefinition,
  SearchTargetRegistryError,
} from './search-target-definition.ts';

const probeSearchDocuments = snakeCase.table('probe_search_documents', {
  ...searchDocumentColumns(),
  name: searchTextColumn('name'),
  tagline: searchTextColumn('tagline'),
});

const otherSearchDocuments = snakeCase.table('other_search_documents', {
  ...searchDocumentColumns(),
  title: searchTextColumn('title'),
});

const probeIndex = defineSearchIndex({
  documents: probeSearchDocuments,
  textColumns: [
    { column: probeSearchDocuments.name, weight: 10 },
    { column: probeSearchDocuments.tagline, weight: 5 },
  ],
  keywordsWeight: 1,
});

const otherIndex = defineSearchIndex({
  documents: otherSearchDocuments,
  textColumns: [{ column: otherSearchDocuments.title, weight: 10 }],
  keywordsWeight: 1,
});

const plainText: SearchFieldSpec = {
  format: 'plain',
  textColumn: true,
  extract: true,
};

const probeTarget = defineSearchTarget({
  name: 'probe',
  fields: {
    name: plainText,
    tagline: plainText,
    description: { format: 'markdown', textColumn: false, extract: true },
  },
  index: probeIndex,
  documents: probeSearchDocuments,
  read: () =>
    Promise.resolve({
      version: 1,
      fields: { name: '名前', tagline: '一言', description: '説明' },
    }),
  isIndexable: (sourceId) => sql`${sourceId} = ${sourceId}`,
});

const otherTarget = defineSearchTarget({
  name: 'other-target-2',
  fields: { title: plainText },
  index: otherIndex,
  documents: otherSearchDocuments,
  read: () => Promise.resolve(undefined),
  isIndexable: () => sql`1`,
});

const expectRegistryError = (
  definitions: readonly SearchTargetDefinition[],
  message: RegExp,
): void => {
  expect(() => createSearchTargetRegistry(definitions)).toThrow(
    SearchTargetRegistryError,
  );
  expect(() => createSearchTargetRegistry(definitions)).toThrow(message);
};

describe('defineSearchTarget', () => {
  test('渡した定義をそのまま返す', () => {
    const definition = { ...otherTarget };

    expect(defineSearchTarget(definition)).toBe(definition);
  });

  test('項目の名前から元データの読み取りの戻り値の型を決める', () => {
    expectTypeOf<
      Awaited<ReturnType<(typeof probeTarget)['read']>>
    >().toEqualTypeOf<
      SearchSource<'name' | 'tagline' | 'description'> | undefined
    >();
  });
});

describe('createSearchTargetRegistry', () => {
  test('登録した検索対象を名前で引き、名前の一覧を登録順に返す', () => {
    const registry = createSearchTargetRegistry([probeTarget, otherTarget]);

    expect(registry.names()).toEqual(['probe', 'other-target-2']);
    expect(registry.find('probe')).toBe(probeTarget);
    expect(registry.definition('other-target-2')).toBe(otherTarget);
  });

  test('登録されていない名前はundefinedを返す', () => {
    const registry = createSearchTargetRegistry([probeTarget]);

    expect(registry.find('other-target-2')).toBeUndefined();
    expect(registry.definition('other-target-2')).toBeUndefined();
    expect(registry.find('__proto__')).toBeUndefined();
    expect(registry.definition('constructor')).toBeUndefined();
  });

  test('検索対象が0件でも登録に成功する', () => {
    const registry = createSearchTargetRegistry([]);

    expect(registry.names()).toEqual([]);
  });

  test('名前の一覧を書き換えても登録の内容は変わらない', () => {
    const registry = createSearchTargetRegistry([probeTarget]);

    expect(Object.isFrozen(registry.names())).toBe(true);
    expect(registry.names()).toBe(registry.names());
  });

  test.each([
    ['大文字を含む', 'Probe'],
    ['数字で始まる', '1probe'],
    ['ハイフンで始まる', '-probe'],
    ['アンダースコアを含む', 'probe_target'],
    ['空', ''],
    ['41文字', `p${'a'.repeat(40)}`],
  ])('名前が%sなら例外にする', (_, name) => {
    expectRegistryError([{ ...probeTarget, name }], /名前/);
  });

  test('40文字の名前は登録できる', () => {
    const name = `p${'a'.repeat(39)}`;

    expect(
      createSearchTargetRegistry([{ ...probeTarget, name }]).names(),
    ).toEqual([name]);
  });

  test('名前が重複したら例外にする', () => {
    expectRegistryError(
      [probeTarget, { ...otherTarget, name: 'probe' }],
      /probe.*重複/,
    );
  });

  test('索引の定義の元テキストの列に対応する項目が無ければ例外にする', () => {
    const fields = {
      name: probeTarget.fields.name,
      description: probeTarget.fields.description,
    };

    expectRegistryError([{ ...probeTarget, fields }], /tagline/);
  });

  test('元テキストの列に保存する項目が索引の定義の列に無ければ例外にする', () => {
    expectRegistryError(
      [
        {
          ...probeTarget,
          fields: { ...probeTarget.fields, summary: plainText },
        },
      ],
      /summary/,
    );
  });

  test('索引の定義の列と同名でも元テキストの列に保存しない項目なら例外にする', () => {
    expectRegistryError(
      [
        {
          ...probeTarget,
          fields: {
            ...probeTarget.fields,
            tagline: { format: 'plain', textColumn: false, extract: true },
          },
        },
      ],
      /tagline/,
    );
  });

  test('キーワード抽出の対象の項目が無ければ例外にする', () => {
    const notExtracted: SearchFieldSpec = { ...plainText, extract: false };

    expectRegistryError(
      [
        {
          ...probeTarget,
          fields: {
            name: notExtracted,
            tagline: notExtracted,
            description: {
              format: 'markdown',
              textColumn: false,
              extract: false,
            },
          },
        },
      ],
      /抽出/,
    );
  });

  test('索引文書のテーブルと索引の定義のテーブル名が異なれば例外にする', () => {
    expectRegistryError(
      [{ ...probeTarget, documents: otherSearchDocuments }],
      /other_search_documents.*probe_search_documents/,
    );
  });

  test('2つの検索対象が同じ索引文書のテーブルを使えば例外にする', () => {
    expectRegistryError(
      [probeTarget, { ...probeTarget, name: 'probe-copy' }],
      /probe_search_documents/,
    );
  });

  test('例外の名前はSearchTargetRegistryErrorになる', () => {
    expect(() =>
      createSearchTargetRegistry([{ ...probeTarget, name: '' }]),
    ).toThrow(expect.objectContaining({ name: 'SearchTargetRegistryError' }));
  });
});

describe('SEARCH_KEYWORD_STATUSES', () => {
  test('DBの状態の値がcoreの状態の型と過不足無く同じになる', () => {
    expectTypeOf<
      (typeof SEARCH_KEYWORD_STATUSES)[number]
    >().toEqualTypeOf<KeywordStatus>();
    expect([...SEARCH_KEYWORD_STATUSES].sort()).toEqual([
      'disabled',
      'extracted',
      'fallback',
      'pending',
      'unsupported',
    ]);
  });
});
