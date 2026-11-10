import { describe, expect, test } from 'bun:test';

import {
  DIRECTORY_ITEM_METRICS,
  DIRECTORY_LIST_INSERTS,
  DIRECTORY_PAGE_SECTIONS,
} from '../../composition/directory-sections.ts';
import type { DirectoryPlacement } from './directory-section-types.ts';

const SECTION_ID_PATTERN = /^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/u;

// APIサーバーの一覧の項目の値の供給元の登録のkeyと同じ形
const METRIC_KEY_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;

const PLACEMENTS: readonly DirectoryPlacement[] = ['banner', 'aside', 'bottom'];

describe('ディレクトリの登録箇所', () => {
  test('初版の区画・一覧の差し込み・項目の値の3つの登録箇所は空である', () => {
    expect(DIRECTORY_PAGE_SECTIONS).toStrictEqual([]);
    expect(DIRECTORY_LIST_INSERTS).toStrictEqual([]);
    expect(DIRECTORY_ITEM_METRICS).toStrictEqual([]);
  });

  test.each([
    ['ディレクトリの区画', DIRECTORY_PAGE_SECTIONS],
    ['一覧の差し込み', DIRECTORY_LIST_INSERTS],
  ] as const)(
    '%sのidは重複せず`<spec名>.<名詞句>`の形で、orderは有限の数である',
    (_name, entries) => {
      const ids = entries.map(({ id }) => id);

      expect(new Set(ids).size).toBe(ids.length);
      expect(ids.every((id) => SECTION_ID_PATTERN.test(id))).toBe(true);
      expect(entries.every(({ order }) => Number.isFinite(order))).toBe(true);
    },
  );

  test('区画の置き場所は3つのいずれかで、差し込みの間隔は1以上の整数である', () => {
    expect(
      DIRECTORY_PAGE_SECTIONS.every(({ placement }) =>
        PLACEMENTS.includes(placement),
      ),
    ).toBe(true);
    expect(
      DIRECTORY_LIST_INSERTS.every(
        ({ every }) => Number.isInteger(every) && every >= 1,
      ),
    ).toBe(true);
  });

  test('項目の値のkeyは重複せず小文字の英数字とハイフンの形で、orderは有限の数である', () => {
    const keys = DIRECTORY_ITEM_METRICS.map(({ key }) => key);

    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.every((key) => METRIC_KEY_PATTERN.test(key))).toBe(true);
    expect(
      DIRECTORY_ITEM_METRICS.every(({ order }) => Number.isFinite(order)),
    ).toBe(true);
  });
});
