import { describe, expect, test } from 'bun:test';

import {
  deleteApiKeyLabelOf,
  editApiKeyLabelOf,
  reissueApiKeyLabelOf,
} from './api-key-list-messages.ts';

describe('APIキーごとの操作のボタンの名前', () => {
  test('キーの名前に操作の名前を続け、同じ操作のボタンをキーごとに区別できるようにする', () => {
    expect(editApiKeyLabelOf('CIの読み取り')).toBe('CIの読み取りを編集');
    expect(reissueApiKeyLabelOf('CIの読み取り')).toBe('CIの読み取りを再発行');
    expect(deleteApiKeyLabelOf('CIの読み取り')).toBe('CIの読み取りを削除');
  });
});
