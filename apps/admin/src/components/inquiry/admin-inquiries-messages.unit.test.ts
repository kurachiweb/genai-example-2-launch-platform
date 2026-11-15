import { describe, expect, test } from 'bun:test';

import {
  handleLabel,
  INQUIRY_KIND_LABELS,
  INQUIRY_LIST_COLUMNS,
} from './admin-inquiries-messages.ts';

describe('管理画面の問い合わせの文言', () => {
  test('ハンドルは先頭に@を付けて示す', () => {
    expect(handleLabel('sample_taro')).toBe('@sample_taro');
  });

  test('種別と一覧の列は、それぞれ異なる表示名を持つ', () => {
    for (const labels of [INQUIRY_KIND_LABELS, INQUIRY_LIST_COLUMNS]) {
      const values = Object.values(labels);
      expect(new Set(values).size).toBe(values.length);
    }
  });
});
