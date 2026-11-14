import { describe, expect, test } from 'bun:test';

import {
  editLegalDocumentName,
  openPublicPageName,
} from './legal-documents-messages.ts';

describe('法務文書の一覧の文言', () => {
  test('行の操作の名前は、見えている操作名の前に対象の文書を置く', () => {
    expect(editLegalDocumentName('利用規約')).toBe('利用規約を編集');
    expect(openPublicPageName('プライバシーポリシー')).toBe(
      'プライバシーポリシーの公開ページを開く',
    );
  });
});
