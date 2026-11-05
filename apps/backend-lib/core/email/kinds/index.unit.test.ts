import { describe, expect, test } from 'bun:test';

import { createEmailKindRegistry } from '../email-kind.ts';
import { ADMIN_EMAIL_KINDS } from './admin.ts';
import { EMAIL_DELIVERY_SMOKE_KIND } from './email-delivery-smoke.ts';
import { IDENTITY_EMAIL_KINDS } from './identity.ts';
import { EMAIL_KINDS } from './index.ts';
import { INQUIRY_REPLY_NOTIFICATION_KIND } from './inquiry.ts';
import { PAYMENTS_EMAIL_KINDS } from './payments.ts';

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

  test('問い合わせの返信の通知の種別をトランザクションメールとして名前で引ける', () => {
    const registry = createEmailKindRegistry(EMAIL_KINDS);

    expect(registry.get('inquiry.reply-notification')).toBe(
      INQUIRY_REPLY_NOTIFICATION_KIND,
    );
    expect(registry.get('inquiry.reply-notification')?.category).toBe(
      'transactional',
    );
  });

  test.each(PAYMENTS_EMAIL_KINDS.map((kind) => [kind.name, kind] as const))(
    '決済の種別%sをトランザクションメールとして名前で引ける',
    (name, kind) => {
      const registry = createEmailKindRegistry(EMAIL_KINDS);

      expect(registry.get(name)).toBe(kind);
      expect(registry.get(name)?.category).toBe('transactional');
    },
  );

  test('決済の種別は購入確認と自動返金の2種である', () => {
    expect(PAYMENTS_EMAIL_KINDS.map((kind) => kind.name)).toEqual([
      'payments.purchase-confirmation',
      'payments.automatic-refund',
    ]);
  });

  test('集約点は凍結されていて実行時に種別を追加できない', () => {
    expect(Object.isFrozen(EMAIL_KINDS)).toBe(true);
  });
});
