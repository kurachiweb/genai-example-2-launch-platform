import { describe, expect, test } from 'bun:test';

import { COLLAPSE_LABEL, READ_MORE_LABEL } from './markdown-messages.ts';

describe('マークダウンの表示の文言', () => {
  test('折りたたみの切替ボタンの文言は設計の文言と同じ', () => {
    expect([READ_MORE_LABEL, COLLAPSE_LABEL]).toStrictEqual([
      '続きを読む',
      '折りたたむ',
    ]);
  });

  test('操作の名前は句点を付けない', () => {
    for (const label of [READ_MORE_LABEL, COLLAPSE_LABEL]) {
      expect(label).not.toMatch(/(?:。|です|ます)$/u);
    }
  });
});
