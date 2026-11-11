import { describe, expect, test } from 'bun:test';

import { HELP_TYPES } from './help-types.ts';

const EXPECTED_NAMES = [
  'HelpArticleStore',
  'HelpCategoryStore',
  'PublicHelpStore',
  'HelpAuthorLookup',
  'HelpArticleEditor',
  'HelpArticleAdminReader',
  'HelpCategoryService',
  'PublicHelpReader',
] as const;

describe('HELP_TYPES', () => {
  test('apiのヘルプのストア・作成者の照会・ユースケースの識別子だけを持つ', () => {
    expect(Object.keys(HELP_TYPES).toSorted()).toEqual(
      [...EXPECTED_NAMES].toSorted(),
    );
  });

  test.each(EXPECTED_NAMES)(
    '%sの識別子はグローバルのシンボル登録簿のhelp.<名前>である',
    (name) => {
      expect<symbol>(HELP_TYPES[name]).toBe(Symbol.for(`help.${name}`));
    },
  );

  test('識別子はすべて互いに異なる', () => {
    expect(new Set(Object.values(HELP_TYPES)).size).toBe(EXPECTED_NAMES.length);
  });

  test('実行時に書き換えられない', () => {
    expect(Object.isFrozen(HELP_TYPES)).toBe(true);
  });
});
