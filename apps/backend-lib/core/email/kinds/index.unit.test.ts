import { describe, expect, test } from 'bun:test';

import { createEmailKindRegistry } from '../email-kind.ts';
import { ADMIN_EMAIL_KINDS } from './admin.ts';
import { REPORT_EMAIL_KINDS } from './content-reporting.ts';
import { DATA_EXPORT_EMAIL_KINDS } from './data-export.ts';
import { EMAIL_DELIVERY_SMOKE_KIND } from './email-delivery-smoke.ts';
import { IDENTITY_EMAIL_KINDS } from './identity.ts';
import { EMAIL_KINDS } from './index.ts';
import { INQUIRY_REPLY_NOTIFICATION_KIND } from './inquiry.ts';
import { NOTIFICATION_EMAIL_KINDS } from './notifications.ts';
import { PAYMENTS_EMAIL_KINDS } from './payments.ts';
import { SPONSORSHIP_EMAIL_KINDS } from './sponsorship.ts';
import { TOURNAMENT_WEEK_EMAIL_KINDS } from './tournament-week.ts';
import { TOURNAMENT_YEAR_EMAIL_KINDS } from './tournament-year.ts';
import { MODERATION_EMAIL_KINDS } from './ugc-moderation.ts';
import { ULTRAS_EMAIL_KINDS } from './ultras.ts';

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

  test.each(ULTRAS_EMAIL_KINDS.map((kind) => [kind.name, kind] as const))(
    '定期課金の種別%sをトランザクションメールとして名前で引ける',
    (name, kind) => {
      const registry = createEmailKindRegistry(EMAIL_KINDS);

      expect(registry.get(name)).toBe(kind);
      expect(registry.get(name)?.category).toBe('transactional');
    },
  );

  test('定期課金の種別は支払いの失敗と解約の受付の2種である', () => {
    expect(ULTRAS_EMAIL_KINDS.map((kind) => kind.name)).toEqual([
      'ultras.payment-failed',
      'ultras.cancellation-accepted',
    ]);
  });

  test.each(
    TOURNAMENT_WEEK_EMAIL_KINDS.map((kind) => [kind.name, kind] as const),
  )(
    'Weekトーナメントの種別%sをトランザクションメールとして名前で引ける',
    (name, kind) => {
      const registry = createEmailKindRegistry(EMAIL_KINDS);

      expect(registry.get(name)).toBe(kind);
      expect(registry.get(name)?.category).toBe('transactional');
    },
  );

  test('Weekトーナメントの種別は返金の知らせの1種である', () => {
    expect(TOURNAMENT_WEEK_EMAIL_KINDS.map((kind) => kind.name)).toEqual([
      'tournament-week.entry-refund',
    ]);
  });

  test.each(
    TOURNAMENT_YEAR_EMAIL_KINDS.map((kind) => [kind.name, kind] as const),
  )(
    'Yearトーナメントの種別%sをトランザクションメールとして名前で引ける',
    (name, kind) => {
      const registry = createEmailKindRegistry(EMAIL_KINDS);

      expect(registry.get(name)).toBe(kind);
      expect(registry.get(name)?.category).toBe('transactional');
    },
  );

  test('Yearトーナメントの種別は返金の知らせの1種である', () => {
    expect(TOURNAMENT_YEAR_EMAIL_KINDS.map((kind) => kind.name)).toEqual([
      'tournament-year.entry-refund',
    ]);
  });

  test.each(SPONSORSHIP_EMAIL_KINDS.map((kind) => [kind.name, kind] as const))(
    'スポンサー広告の種別%sをトランザクションメールとして名前で引ける',
    (name, kind) => {
      const registry = createEmailKindRegistry(EMAIL_KINDS);

      expect(registry.get(name)).toBe(kind);
      expect(registry.get(name)?.category).toBe('transactional');
    },
  );

  test('スポンサー広告の種別は掲載開始・掲載終了・強制終了の通知の3種である', () => {
    expect(SPONSORSHIP_EMAIL_KINDS.map((kind) => kind.name)).toEqual([
      'sponsorship.start-notice',
      'sponsorship.end-notice',
      'sponsorship.termination-notice',
    ]);
  });

  test.each(MODERATION_EMAIL_KINDS.map((kind) => [kind.name, kind] as const))(
    '措置の通知の種別%sをトランザクションメールとして名前で引ける',
    (name, kind) => {
      const registry = createEmailKindRegistry(EMAIL_KINDS);

      expect(registry.get(name)).toBe(kind);
      expect(registry.get(name)?.category).toBe('transactional');
    },
  );

  test('措置の通知の種別は停止・プロダクトの非公開化・コメントの非公開化の3種である', () => {
    expect(MODERATION_EMAIL_KINDS.map((kind) => kind.name)).toEqual([
      'ugc-moderation.user-suspended',
      'ugc-moderation.product-hidden',
      'ugc-moderation.comment-hidden',
    ]);
  });

  test.each(REPORT_EMAIL_KINDS.map((kind) => [kind.name, kind] as const))(
    '通報の種別%sをトランザクションメールとして名前で引ける',
    (name, kind) => {
      const registry = createEmailKindRegistry(EMAIL_KINDS);

      expect(registry.get(name)).toBe(kind);
      expect(registry.get(name)?.category).toBe('transactional');
    },
  );

  test('通報の種別は申出者への対応結果・投稿者への却下・権利侵害の照会の3種である', () => {
    expect(REPORT_EMAIL_KINDS.map((kind) => kind.name)).toEqual([
      'content-reporting.report-outcome',
      'content-reporting.rejection-to-poster',
      'content-reporting.infringement-inquiry',
    ]);
  });

  test.each(DATA_EXPORT_EMAIL_KINDS.map((kind) => [kind.name, kind] as const))(
    'データエクスポートの種別%sをトランザクションメールとして名前で引ける',
    (name, kind) => {
      const registry = createEmailKindRegistry(EMAIL_KINDS);

      expect(registry.get(name)).toBe(kind);
      expect(registry.get(name)?.category).toBe('transactional');
    },
  );

  test('データエクスポートの種別は完了と失敗の2種である', () => {
    expect(DATA_EXPORT_EMAIL_KINDS.map((kind) => kind.name)).toEqual([
      'data-export.archive-ready',
      'data-export.archive-failed',
    ]);
  });

  test.each(NOTIFICATION_EMAIL_KINDS.map((kind) => [kind.name, kind] as const))(
    '通知メールの種別%sを通知メールとして名前で引ける',
    (name, kind) => {
      const registry = createEmailKindRegistry(EMAIL_KINDS);

      expect(registry.get(name)).toBe(kind);
      expect(registry.get(name)?.category).toBe('notification');
    },
  );

  test('通知メールの種別は開始予告・勝敗結果・開催通知・受賞結果の4種で、すべて集約点に載る', () => {
    expect(NOTIFICATION_EMAIL_KINDS.map((kind) => kind.name)).toEqual([
      'notifications.match-preview',
      'notifications.match-result',
      'notifications.followed-user-matches',
      'notifications.followed-user-award',
    ]);
    expect(
      EMAIL_KINDS.filter((kind) => kind.category === 'notification'),
    ).toEqual([...NOTIFICATION_EMAIL_KINDS]);
  });

  test('集約点は凍結されていて実行時に種別を追加できない', () => {
    expect(Object.isFrozen(EMAIL_KINDS)).toBe(true);
  });
});
