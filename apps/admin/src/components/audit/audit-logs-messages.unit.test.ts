import { describe, expect, test } from 'bun:test';

import {
  AUDIT_TARGET_KIND_LABELS,
  deletedOperatorLabel,
  unlistedOperatorLabel,
} from './audit-logs-messages.ts';

describe('監査ログの文言', () => {
  test('操作者を示す文言にIDを含める', () => {
    expect(deletedOperatorLabel('01JC0ADMIN0000000000000000DD')).toBe(
      '削除済みの管理者(ID: 01JC0ADMIN0000000000000000DD)',
    );
    expect(unlistedOperatorLabel('01JC0ADMIN0000000000000000DD')).toBe(
      '一覧に無い管理者(ID: 01JC0ADMIN0000000000000000DD)',
    );
  });

  test('対象の種類ごとに異なる表示名を持つ', () => {
    const labels = Object.values(AUDIT_TARGET_KIND_LABELS);

    expect(new Set(labels).size).toBe(labels.length);
  });
});
