import { render } from '@react-email/render';
import { describe, expect, test } from 'vitest';

import { EMAIL_DELIVERY_SMOKE_KIND } from '../../../../../lib/core/email/kinds/email-delivery-smoke.ts';
import { SMOKE_TEMPLATE } from './smoke-template.ts';

const INPUT = { requestedAt: '2026-10-27T07:40:00Z' } as const;

describe('疎通確認メールのテンプレート', () => {
  test('疎通確認の種別に対応し、接頭辞の無い件名「メール送信の確認」を返す', () => {
    expect(SMOKE_TEMPLATE.kind).toBe(EMAIL_DELIVERY_SMOKE_KIND);
    expect(SMOKE_TEMPLATE.subject(INPUT)).toBe('メール送信の確認');
  });

  test('受信一覧に出る冒頭の文を日本語で返す', () => {
    expect(SMOKE_TEMPLATE.preview(INPUT)).toBe(
      'メール送信の確認のために送信したメールです。',
    );
  });

  test('宛名・行動ボタン・配信停止のURLを持たない', () => {
    expect(SMOKE_TEMPLATE.greeting(INPUT)).toBeUndefined();
    expect(Object.hasOwn(SMOKE_TEMPLATE, 'action')).toBe(false);
    expect(Object.hasOwn(SMOKE_TEMPLATE, 'unsubscribeUrl')).toBe(false);
  });

  test('本文に日本語の段落と、time要素で包んだ受付日時のUTC表記を置く', async () => {
    const html = await render(<SMOKE_TEMPLATE.Body input={INPUT} />);

    expect(html).toContain('メール送信の確認のために送信したメールです。');
    // HTMLの属性名は大文字小文字を区別しないため、Reactの出力するdateTimeもdatetimeとして解釈される
    expect(html).toMatch(
      /受付日時は<time datetime="2026-10-27T07:40:00\.000Z">10月27日07:40\(UTC\)<\/time>です。/iu,
    );
    expect(html).toContain('このメールへの返信は不要です。');
    expect(html).not.toContain('<!-- -->');
  });
});
