import { describe, expect, test } from 'bun:test';

import {
  EXCLUDED_ENTITY_TYPES,
  MAX_KEYWORDS,
  selectKeywords,
} from './keyword-selection.ts';

const entity = (name: string, type = 'OTHER') => ({ name, type });

describe('EXCLUDED_ENTITY_TYPES', () => {
  test('電話番号・住所・日付・数・価格の5種を除く', () => {
    expect(EXCLUDED_ENTITY_TYPES).toEqual([
      'PHONE_NUMBER',
      'ADDRESS',
      'DATE',
      'NUMBER',
      'PRICE',
    ]);
  });
});

describe('selectKeywords', () => {
  test('エンティティの名前を出現順に半角スペースで結合する', () => {
    const keywords = selectKeywords([
      entity('ローンチ', 'EVENT'),
      entity('Launch Stadium', 'ORGANIZATION'),
      entity('製品', 'CONSUMER_GOOD'),
    ]);

    expect(keywords).toBe('ローンチ Launch Stadium 製品');
  });

  test('除外する種類のエンティティを除き、それ以外の種類は全て残す', () => {
    const kept = [
      'UNKNOWN',
      'PERSON',
      'LOCATION',
      'ORGANIZATION',
      'EVENT',
      'WORK_OF_ART',
      'CONSUMER_GOOD',
      'OTHER',
    ].map((type) => entity(`kept-${type}`, type));
    const excluded = EXCLUDED_ENTITY_TYPES.map((type) =>
      entity(`excluded-${type}`, type),
    );

    const keywords = selectKeywords([...excluded, ...kept]);

    expect(keywords).toBe(kept.map(({ name }) => name).join(' '));
  });

  test('名前をNFKC正規化し、空白の並びを1つの半角スペースにして前後を除く', () => {
    const keywords = selectKeywords([
      entity('　Ｌａｕｎｃｈ\n\tＳｔａｄｉｕｍ　'),
      entity('ｶﾞｲﾄﾞ'),
    ]);

    expect(keywords).toBe('Launch Stadium ガイド');
  });

  test('正規化して空になった名前を除く', () => {
    const keywords = selectKeywords([
      entity('前'),
      entity(''),
      entity(' 　\n'),
      entity('後'),
    ]);

    expect(keywords).toBe('前 後');
  });

  test('正規化して小文字にした値が同じ名前は、最初に出現した表記だけを残す', () => {
    const keywords = selectKeywords([
      entity('Launch'),
      entity('ＬＡＵＮＣＨ'),
      entity('製品'),
      entity('launch '),
      entity('製品', 'CONSUMER_GOOD'),
    ]);

    expect(keywords).toBe('Launch 製品');
  });

  test('除外した種類の名前は、同じ名前の除外しない種類の重複の判定に使わない', () => {
    const keywords = selectKeywords([
      entity('2026', 'DATE'),
      entity('2026', 'EVENT'),
    ]);

    expect(keywords).toBe('2026');
  });

  test('重複を除いた後の出現順で最大500件にする', () => {
    const entities = [
      entity('duplicate'),
      ...Array.from({ length: MAX_KEYWORDS + 10 }, (_, index) => [
        entity(`k${String(index)}`),
        entity('duplicate'),
      ]).flat(),
    ];

    const keywords = selectKeywords(entities).split(' ');

    expect(MAX_KEYWORDS).toBe(500);
    expect(keywords).toHaveLength(MAX_KEYWORDS);
    expect(keywords[0]).toBe('duplicate');
    expect(keywords.at(-1)).toBe(`k${String(MAX_KEYWORDS - 2)}`);
  });

  test('エンティティが無ければ空文字列にする', () => {
    expect(selectKeywords([])).toBe('');
  });

  test('100,000件のエンティティを処理時間が2乗にならずに選別する', () => {
    const entities = Array.from({ length: 100_000 }, (_, index) =>
      entity(`同じ名前${String(index % 100)}`),
    );

    const startedAt = performance.now();
    const keywords = selectKeywords(entities);
    const elapsed = performance.now() - startedAt;

    expect(keywords.split(' ')).toHaveLength(100);
    expect(elapsed).toBeLessThan(500);
  });
});
