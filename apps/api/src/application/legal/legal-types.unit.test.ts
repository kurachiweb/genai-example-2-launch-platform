import { describe, expect, test } from 'bun:test';

import { LEGAL_TYPES } from './legal-types.ts';

const EXPECTED_NAMES = [
  'LegalDocumentStore',
  'LegalDocumentReader',
  'LegalDocumentAdminReader',
  'LegalDraftEditor',
  'LegalDocumentPublisher',
  'LegalVersionLocator',
] as const;

describe('LEGAL_TYPES', () => {
  test('法務文書のストア・ユースケース・照会口の識別子だけを持つ', () => {
    expect(Object.keys(LEGAL_TYPES).toSorted()).toEqual(
      [...EXPECTED_NAMES].toSorted(),
    );
  });

  test.each(EXPECTED_NAMES)(
    '%sの識別子はグローバルのシンボル登録簿のlegal.<名前>である',
    (name) => {
      expect<symbol>(LEGAL_TYPES[name]).toBe(Symbol.for(`legal.${name}`));
    },
  );

  test('識別子はすべて互いに異なる', () => {
    expect(new Set(Object.values(LEGAL_TYPES)).size).toBe(
      EXPECTED_NAMES.length,
    );
  });

  test('実行時に書き換えられない', () => {
    expect(Object.isFrozen(LEGAL_TYPES)).toBe(true);
  });
});
