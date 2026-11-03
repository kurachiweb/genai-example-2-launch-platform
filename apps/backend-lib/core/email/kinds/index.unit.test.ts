import { describe, expect, test } from 'bun:test';

import { createEmailKindRegistry } from '../email-kind.ts';
import { ADMIN_EMAIL_KINDS } from './admin.ts';
import { EMAIL_DELIVERY_SMOKE_KIND } from './email-delivery-smoke.ts';
import { IDENTITY_EMAIL_KINDS } from './identity.ts';
import { EMAIL_KINDS } from './index.ts';

describe('EMAIL_KINDS', () => {
  test('集約した全種別を例外なく登録できる', () => {
    expect(() => createEmailKindRegistry(EMAIL_KINDS)).not.toThrow();
  });

  test('疎通確認用の種別を名前で引ける', () => {
    const registry = createEmailKindRegistry(EMAIL_KINDS);

    expect(registry.get('email-delivery.smoke')).toBe(
      EMAIL_DELIVERY_SMOKE_KIND,
    );
  });

  test.each(IDENTITY_EMAIL_KINDS.map((kind) => [kind.name, kind] as const))(
    '認証系の種別%sをトランザクションメールとして名前で引ける',
    (name, kind) => {
      const registry = createEmailKindRegistry(EMAIL_KINDS);

      expect(registry.get(name)).toBe(kind);
      expect(registry.get(name)?.category).toBe('transactional');
    },
  );

  test.each(ADMIN_EMAIL_KINDS.map((kind) => [kind.name, kind] as const))(
    '管理者の種別%sをトランザクションメールとして名前で引ける',
    (name, kind) => {
      const registry = createEmailKindRegistry(EMAIL_KINDS);

      expect(registry.get(name)).toBe(kind);
      expect(registry.get(name)?.category).toBe('transactional');
    },
  );

  test('集約点は凍結されていて実行時に種別を追加できない', () => {
    expect(Object.isFrozen(EMAIL_KINDS)).toBe(true);
  });
});
