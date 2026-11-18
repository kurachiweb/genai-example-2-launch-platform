import { describe, expect, test } from 'bun:test';

import { documentIdOf } from '../../lib/utilities/graphql/persisted-document.ts';
import { adminYearFinalDateSettingsQueryOptions } from './admin-year-final-date.ts';
import { AdminYearFinalDateSettingsDocument } from './generated/graphql.ts';

describe('adminYearFinalDateSettingsQueryOptions', () => {
  test('操作の識別子と空の変数だけのキーを持つ', () => {
    expect([
      ...adminYearFinalDateSettingsQueryOptions().queryKey,
    ]).toStrictEqual([documentIdOf(AdminYearFinalDateSettingsDocument), {}]);
  });
});
