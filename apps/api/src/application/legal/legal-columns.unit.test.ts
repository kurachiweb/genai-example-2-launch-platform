import { describe, expect, expectTypeOf, test } from 'bun:test';

import {
  LEGAL_DOCUMENT_KINDS,
  type LegalDocumentKind,
} from '../../../common-lib/legal/legal-documents.ts';
import { legalDocuments } from '../../../db/schema/legal/legal-documents.ts';

// 共用部品とドメイン層はDBディレクトリを読み込めないため、テーブル定義に直書きした種類の値と共用部品の種類の一致を、DBのスキーマを読み込めるapplication層で確かめる
describe('法務文書のテーブル定義の値の一覧', () => {
  test('種類の列の値が共用部品の種類の表示順の一覧と同じ順で同じになる', () => {
    expectTypeOf<
      (typeof legalDocuments.kind.enumValues)[number]
    >().toEqualTypeOf<LegalDocumentKind>();
    expect([...legalDocuments.kind.enumValues]).toEqual([
      ...LEGAL_DOCUMENT_KINDS,
    ]);
  });
});
