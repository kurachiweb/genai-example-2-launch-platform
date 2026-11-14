import { describe, expect, test } from 'bun:test';

import {
  isLegalDocumentKind,
  LEGAL_DOCUMENT_EXTERNAL_LINK_REL,
  LEGAL_DOCUMENT_KINDS,
  LEGAL_DOCUMENT_LABELS,
  LEGAL_DOCUMENT_PATHS,
  legalRevisionPath,
  legalVersionLabel,
  legalVersionTitle,
  parseVersionNumber,
} from './legal-documents.ts';

describe('法務文書の種類', () => {
  test('利用規約・プライバシーポリシー・法的通知の順に並ぶ', () => {
    expect(LEGAL_DOCUMENT_KINDS).toEqual(['terms', 'privacy', 'legal-notice']);
  });

  test('一覧を書き換えられない', () => {
    expect(Object.isFrozen(LEGAL_DOCUMENT_KINDS)).toBe(true);
  });

  test.each([['terms'], ['privacy'], ['legal-notice']])(
    '%sを種類と判定する',
    (value) => {
      expect(isLegalDocumentKind(value)).toBe(true);
    },
  );

  test.each([
    ['利用者側のパスの名前', 'legal'],
    ['大文字を含む値', 'Terms'],
    ['先頭にスラッシュを付けた値', '/terms'],
    ['空文字列', ''],
    ['プロトタイプの名前', 'toString'],
  ])('%s(%s)を種類でないと判定する', (_, value) => {
    expect(isLegalDocumentKind(value)).toBe(false);
  });
});

describe('法務文書の名前と利用者側のパス', () => {
  test.each([
    ['terms', '利用規約', '/terms'],
    ['privacy', 'プライバシーポリシー', '/privacy'],
    ['legal-notice', '法的通知', '/legal'],
  ] as const)('%sの名前が%s、パスが%sになる', (kind, label, path) => {
    expect(LEGAL_DOCUMENT_LABELS[kind]).toBe(label);
    expect(LEGAL_DOCUMENT_PATHS[kind]).toBe(path);
  });

  test('全ての種類に名前とパスがあり、余分な項目が無い', () => {
    expect(Object.keys(LEGAL_DOCUMENT_LABELS).toSorted()).toEqual(
      [...LEGAL_DOCUMENT_KINDS].toSorted(),
    );
    expect(Object.keys(LEGAL_DOCUMENT_PATHS).toSorted()).toEqual(
      [...LEGAL_DOCUMENT_KINDS].toSorted(),
    );
  });

  test('名前とパスの対応を書き換えられない', () => {
    expect(Object.isFrozen(LEGAL_DOCUMENT_LABELS)).toBe(true);
    expect(Object.isFrozen(LEGAL_DOCUMENT_PATHS)).toBe(true);
  });
});

describe('legalRevisionPath', () => {
  test.each([
    ['terms', 1, '/terms/revisions/1'],
    ['privacy', 12, '/privacy/revisions/12'],
    ['legal-notice', 999_999_999, '/legal/revisions/999999999'],
  ] as const)('%sの版%iのパスを%sにする', (kind, versionNumber, path) => {
    expect(legalRevisionPath(kind, versionNumber)).toBe(path);
  });
});

describe('parseVersionNumber', () => {
  test.each([
    ['1', 1],
    ['10', 10],
    ['999999999', 999_999_999],
  ])('%sを版番号%iと解析する', (raw, versionNumber) => {
    expect(parseVersionNumber(raw)).toBe(versionNumber);
  });

  test.each([
    ['0'],
    ['01'],
    ['-1'],
    ['+1'],
    ['1.5'],
    ['1.0'],
    ['1e3'],
    ['abc'],
    ['1a'],
    ['１'],
    [' 1'],
    ['1 '],
    [''],
    ['1000000000'],
    ['0x1'],
  ])('「%s」を版番号として扱わない', (raw) => {
    expect(parseVersionNumber(raw)).toBeUndefined();
  });
});

describe('法務文書の本文の外部リンクのrel', () => {
  test('noopenerだけを付ける', () => {
    expect(LEGAL_DOCUMENT_EXTERNAL_LINK_REL).toEqual(['noopener']);
    expect(Object.isFrozen(LEGAL_DOCUMENT_EXTERNAL_LINK_REL)).toBe(true);
  });
});

describe('版番号を含む法務文書の呼び名', () => {
  test('版の呼び名は版番号を「第N版」と示す', () => {
    expect(legalVersionLabel(1)).toBe('第1版');
    expect(legalVersionLabel(12)).toBe('第12版');
  });

  test('版の題名は文書の名前の後に版の呼び名を括弧で添える', () => {
    expect(legalVersionTitle('利用規約', 3)).toBe('利用規約(第3版)');
  });
});
