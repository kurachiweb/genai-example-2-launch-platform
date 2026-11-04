import { describe, expect, test } from 'bun:test';

import {
  editLegalDocumentName,
  legalVersionLabel,
  legalVersionTitle,
  openPublicPageName,
} from './legal-documents-messages.ts';

describe('法務文書の一覧と版の文言', () => {
  test('行の操作の名前は、見えている操作名の前に対象の文書を置く', () => {
    expect(editLegalDocumentName('利用規約')).toBe('利用規約を編集');
    expect(openPublicPageName('プライバシーポリシー')).toBe(
      'プライバシーポリシーの公開ページを開く',
    );
  });

  test('版の呼び名は版番号を「第N版」と示す', () => {
    expect(legalVersionLabel(1)).toBe('第1版');
    expect(legalVersionLabel(12)).toBe('第12版');
  });

  test('版の表示の題名は文書の名前の後に版の呼び名を括弧で添える', () => {
    expect(legalVersionTitle('特定商取引法に基づく表記', 2)).toBe(
      '特定商取引法に基づく表記(第2版)',
    );
  });
});
