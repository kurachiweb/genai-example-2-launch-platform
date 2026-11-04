import { describe, expect, test } from 'bun:test';

import {
  legalVersionLabel,
  legalVersionTitle,
  pastVersionNotice,
} from './legal-messages.ts';

describe('版番号を含む法務文書の文言', () => {
  test('版の呼び名は版番号を「第N版」と示す', () => {
    expect(legalVersionLabel(1)).toBe('第1版');
    expect(legalVersionLabel(12)).toBe('第12版');
  });

  test('過去版の案内は版の呼び名と最新版ではないことを示す', () => {
    expect(pastVersionNotice(2)).toBe(
      'これは第2版です。最新版ではありません。',
    );
  });

  test('過去版の題名は文書の名前の後に版の呼び名を括弧で添える', () => {
    expect(legalVersionTitle('利用規約', 3)).toBe('利用規約(第3版)');
  });
});
