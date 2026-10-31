import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';

import {
  buildIndexDocument,
  KEYWORD_SELECTION_VERSION,
  MAX_EXTRACTION_INPUT_BYTES,
} from './index-document.ts';
import type { SearchSource, SearchTargetInfo } from './search-target.ts';

type ProductField = 'summary' | 'internalNote' | 'title' | 'body';

const PRODUCT_TARGET: SearchTargetInfo<ProductField> = {
  name: 'product',
  fields: {
    summary: { format: 'plain', textColumn: true, extract: true },
    internalNote: { format: 'plain', textColumn: true, extract: false },
    title: { format: 'plain', textColumn: false, extract: true },
    body: { format: 'markdown', textColumn: true, extract: true },
  },
};

const PRODUCT_SOURCE: SearchSource<ProductField> = {
  version: 1_793_000_000_000,
  fields: {
    body: '## 機能の**概要**\n\n[リンク](https://other.example)と`コード`の説明。\n\n- 項目Ａ\n- 項目Ｂ',
    title: '  Ｌａｕｎｃｈ　Ｓｔａｄｉｕｍ\n\n２０２６  ',
    internalNote: '抽出の対象でないメモ',
    summary: '要約',
  },
};

const FAMILY_EMOJI = '\u{1F468}‍\u{1F469}‍\u{1F467}';

const textEncoder = new TextEncoder();

const utf8ByteLength = (text: string): number =>
  textEncoder.encode(text).byteLength;

const expectedHash = (input: string): string =>
  createHash('sha256')
    .update(`${KEYWORD_SELECTION_VERSION}\u0000${input}`, 'utf8')
    .digest('hex');

const SINGLE_FIELD_TARGET: SearchTargetInfo<'text'> = {
  name: 'single',
  fields: { text: { format: 'plain', textColumn: false, extract: true } },
};

const singleFieldSource = (text: string): SearchSource<'text'> => ({
  version: 1,
  fields: { text },
});

describe('buildIndexDocument', () => {
  test('元データの版をそのまま索引文書の版にする', async () => {
    const document = await buildIndexDocument(PRODUCT_TARGET, PRODUCT_SOURCE);

    expect(document.sourceVersion).toBe(PRODUCT_SOURCE.version);
  });

  test('プレーンテキストの項目をNFKC正規化し、空白の並びを1つの半角スペースにして前後を除く', async () => {
    const document = await buildIndexDocument(
      {
        name: 'product',
        fields: { title: { format: 'plain', textColumn: true, extract: true } },
      },
      { version: 1, fields: { title: PRODUCT_SOURCE.fields.title } },
    );

    expect(document.texts).toEqual({ title: 'Launch Stadium 2026' });
  });

  test('プレーンテキストの項目のマークダウンの記号は構文として除かない', async () => {
    const document = await buildIndexDocument(SINGLE_FIELD_TARGET, {
      version: 1,
      fields: { text: '**太字**と`コード`' },
    });

    expect(document.extractionInput).toBe('**太字**と`コード`');
  });

  test('マークダウンの項目を描画と同じ解釈で構文を除いてから正規化する', async () => {
    const document = await buildIndexDocument(PRODUCT_TARGET, PRODUCT_SOURCE);

    expect(document.texts['body']).toBe(
      '機能の概要 リンクとコードの説明。 項目A 項目B',
    );
  });

  test('元テキストの列の項目だけを、正規化したテキストで列に入れる', async () => {
    const document = await buildIndexDocument(PRODUCT_TARGET, PRODUCT_SOURCE);

    expect(document.texts).toEqual({
      summary: '要約',
      internalNote: '抽出の対象でないメモ',
      body: '機能の概要 リンクとコードの説明。 項目A 項目B',
    });
  });

  test('抽出の対象の項目だけを、元データの項目の順ではなく宣言の順に空行で結合する', async () => {
    const document = await buildIndexDocument(PRODUCT_TARGET, PRODUCT_SOURCE);

    expect(document.extractionInput).toBe(
      [
        '要約',
        'Launch Stadium 2026',
        '機能の概要 リンクとコードの説明。 項目A 項目B',
      ].join('\n\n'),
    );
  });

  test('抽出の入力に、抽出の対象でない項目と宣言していない項目の文字列を含めない', async () => {
    const source = {
      version: 1,
      fields: {
        ...PRODUCT_SOURCE.fields,
        authorId: 'user-0123456789',
      },
    } as SearchSource<ProductField>;

    const document = await buildIndexDocument(PRODUCT_TARGET, source);

    expect(document.extractionInput).not.toContain(
      PRODUCT_SOURCE.fields.internalNote,
    );
    expect(document.extractionInput).not.toContain('user-0123456789');
    expect(Object.keys(document.texts)).not.toContain('authorId');
  });

  test('正規化して空になった抽出の対象の項目は結合に含めない', async () => {
    const document = await buildIndexDocument(PRODUCT_TARGET, {
      version: 1,
      fields: {
        summary: ' 　\n',
        internalNote: 'メモ',
        title: 'タイトル',
        body: '\n\n  ---\n\n',
      },
    });

    expect(document.extractionInput).toBe('タイトル');
    expect(document.texts).toEqual({
      summary: '',
      internalNote: 'メモ',
      body: '',
    });
  });

  test('抽出の対象の項目が全て空なら抽出の入力を空にする', async () => {
    const document = await buildIndexDocument(PRODUCT_TARGET, {
      version: 1,
      fields: { summary: '', internalNote: 'メモ', title: ' ', body: '' },
    });

    expect(document.extractionInput).toBe('');
    expect(document.extractionInputHash).toBe(expectedHash(''));
  });

  test('宣言した項目の文字列が元データに無ければ例外にする', async () => {
    const source = {
      version: 1,
      fields: { summary: '要約', internalNote: 'メモ', body: '本文' },
    } as unknown as SearchSource<ProductField>;

    const error: unknown = await buildIndexDocument(
      PRODUCT_TARGET,
      source,
    ).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(TypeError);
    expect(error).toHaveProperty(
      'message',
      '検索対象productの元データに項目titleの文字列がありません。',
    );
  });

  describe('抽出の入力の上限', () => {
    test('上限はAPIの1要求の上限1,000,000バイト未満の900,000バイトである', () => {
      expect(MAX_EXTRACTION_INPUT_BYTES).toBe(900_000);
    });

    test('UTF-8でちょうど上限のバイト数の入力は切り詰めない', async () => {
      const text = 'a'.repeat(MAX_EXTRACTION_INPUT_BYTES);

      const document = await buildIndexDocument(
        SINGLE_FIELD_TARGET,
        singleFieldSource(text),
      );

      expect(document.extractionInput).toBe(text);
    });

    test('上限を超える多バイト文字の入力を、上限に収まる最長の書記素の並びに切り詰める', async () => {
      const text = 'あ'.repeat(MAX_EXTRACTION_INPUT_BYTES);

      const document = await buildIndexDocument(
        SINGLE_FIELD_TARGET,
        singleFieldSource(text),
      );

      expect(document.extractionInput).toBe(
        'あ'.repeat(MAX_EXTRACTION_INPUT_BYTES / 3),
      );
    });

    test('上限が書記素の途中に当たる場合は、その書記素の前で切り詰める', async () => {
      const prefix = 'a'.repeat(MAX_EXTRACTION_INPUT_BYTES - 5);
      const text = `${prefix}${FAMILY_EMOJI}${'b'.repeat(10)}`;

      const document = await buildIndexDocument(
        SINGLE_FIELD_TARGET,
        singleFieldSource(text),
      );

      expect(document.extractionInput).toBe(prefix);
    });

    test('対のない代理はUTF-8で置き換えられるU+FFFDの3バイトとして数える', async () => {
      const prefix = 'a'.repeat(MAX_EXTRACTION_INPUT_BYTES - 2);
      const text = `${prefix}\u{D800}b`;

      const document = await buildIndexDocument(
        SINGLE_FIELD_TARGET,
        singleFieldSource(text),
      );

      expect(document.extractionInput).toBe(prefix);
    });

    test('結合した後の入力に上限を掛け、項目の区切りもバイト数に含める', async () => {
      const first = 'a'.repeat(MAX_EXTRACTION_INPUT_BYTES - 3);
      const document = await buildIndexDocument(
        {
          name: 'pair',
          fields: {
            first: { format: 'plain', textColumn: true, extract: true },
            second: { format: 'plain', textColumn: true, extract: true },
          },
        },
        { version: 1, fields: { first, second: 'bcdef' } },
      );

      expect(document.extractionInput).toBe(`${first}\n\nb`);
      expect(utf8ByteLength(document.extractionInput)).toBe(
        MAX_EXTRACTION_INPUT_BYTES,
      );
      expect(document.texts).toEqual({ first, second: 'bcdef' });
    });

    test('切り詰めた入力は書記素を壊さず、上限を超えない', async () => {
      const text = `${FAMILY_EMOJI}éあa`.repeat(
        MAX_EXTRACTION_INPUT_BYTES / 12,
      );

      const document = await buildIndexDocument(
        SINGLE_FIELD_TARGET,
        singleFieldSource(text),
      );

      expect(utf8ByteLength(document.extractionInput)).toBeLessThanOrEqual(
        MAX_EXTRACTION_INPUT_BYTES,
      );
      expect(text.startsWith(document.extractionInput)).toBe(true);
      expect(document.extractionInput.endsWith('a')).toBe(true);
      expect(
        utf8ByteLength(document.extractionInput) + utf8ByteLength(FAMILY_EMOJI),
      ).toBeGreaterThan(MAX_EXTRACTION_INPUT_BYTES);
    });

    test('上限の数倍の入力も、入力の長さに比例する時間で切り詰める', async () => {
      const text = `${FAMILY_EMOJI}あa`.repeat(MAX_EXTRACTION_INPUT_BYTES);

      const startedAt = performance.now();
      const document = await buildIndexDocument(
        SINGLE_FIELD_TARGET,
        singleFieldSource(text),
      );
      const elapsedMilliseconds = performance.now() - startedAt;

      expect(utf8ByteLength(document.extractionInput)).toBeLessThanOrEqual(
        MAX_EXTRACTION_INPUT_BYTES,
      );
      expect(elapsedMilliseconds).toBeLessThan(3_000);
    });
  });

  describe('抽出の入力のハッシュ', () => {
    test('選別の規則の版と抽出の入力をNUL文字で連結したSHA-256の16進にする', async () => {
      const document = await buildIndexDocument(PRODUCT_TARGET, PRODUCT_SOURCE);

      expect(document.extractionInputHash).toBe(
        expectedHash(document.extractionInput),
      );
      expect(document.extractionInputHash).toMatch(/^[0-9a-f]{64}$/u);
    });

    test('選別の規則の版は空でない文字列である', () => {
      expect(KEYWORD_SELECTION_VERSION).not.toBe('');
    });

    test('同じ入力と選別の規則の版からは同じハッシュになる', async () => {
      const first = await buildIndexDocument(PRODUCT_TARGET, PRODUCT_SOURCE);
      const second = await buildIndexDocument(PRODUCT_TARGET, {
        ...PRODUCT_SOURCE,
        version: PRODUCT_SOURCE.version + 1,
      });

      expect(second.extractionInputHash).toBe(first.extractionInputHash);
    });

    test('抽出の対象でない項目だけが変わってもハッシュは変わらない', async () => {
      const first = await buildIndexDocument(PRODUCT_TARGET, PRODUCT_SOURCE);
      const second = await buildIndexDocument(PRODUCT_TARGET, {
        ...PRODUCT_SOURCE,
        fields: { ...PRODUCT_SOURCE.fields, internalNote: '別のメモ' },
      });

      expect(second.extractionInputHash).toBe(first.extractionInputHash);
    });

    test('正規化の後に同じになる入力からは同じハッシュになる', async () => {
      const first = await buildIndexDocument(
        SINGLE_FIELD_TARGET,
        singleFieldSource('Ｌａｕｎｃｈ  Stadium'),
      );
      const second = await buildIndexDocument(
        SINGLE_FIELD_TARGET,
        singleFieldSource(' Launch\nStadium '),
      );

      expect(second.extractionInputHash).toBe(first.extractionInputHash);
    });

    test('抽出の対象の項目が変わるとハッシュが変わる', async () => {
      const first = await buildIndexDocument(PRODUCT_TARGET, PRODUCT_SOURCE);
      const second = await buildIndexDocument(PRODUCT_TARGET, {
        ...PRODUCT_SOURCE,
        fields: { ...PRODUCT_SOURCE.fields, summary: '別の要約' },
      });

      expect(second.extractionInputHash).not.toBe(first.extractionInputHash);
    });

    test('切り詰めた後の抽出の入力からハッシュを求める', async () => {
      const prefix = 'a'.repeat(MAX_EXTRACTION_INPUT_BYTES);

      const document = await buildIndexDocument(
        SINGLE_FIELD_TARGET,
        singleFieldSource(`${prefix}b`),
      );

      expect(document.extractionInputHash).toBe(expectedHash(prefix));
    });
  });
});
