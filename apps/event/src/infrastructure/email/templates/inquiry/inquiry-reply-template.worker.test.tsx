import { describe, expect, test } from 'vitest';

import { EMAIL_KINDS } from '../../../../../lib/core/email/kinds/index.ts';
import { INQUIRY_REPLY_NOTIFICATION_KIND } from '../../../../../lib/core/email/kinds/inquiry.ts';
import { createEmailTemplateRegistry } from '../../rendering/email-template.ts';
import { ReactEmailRenderer } from '../../rendering/react-email-renderer.tsx';
import { EMAIL_TEMPLATES } from '../index.ts';
import { INQUIRY_REPLY_TEMPLATE } from './inquiry-reply-template.ts';

const NICKNAME = '山田 はなこ';

const INQUIRY_URL =
  'https://client.example/inquiries/01JBX3M5Q4ZQ7Y8W9V0T1S2R3P';

const INPUT = {
  nickname: NICKNAME,
  inquiryUrl: INQUIRY_URL,
  repliedAt: '2026-11-02T07:40:00.000Z',
};

const REPLY_BODY = 'ご不便をおかけして申し訳ありません。返信の本文です。';

const SUBJECT = 'お問い合わせに返信がありました';

const ACTION_LABEL = '問い合わせを確認する';

const GUIDANCE =
  '下のボタンからチャットページを開き、返信の内容を確認してください。';

function createRenderer(): ReactEmailRenderer {
  return new ReactEmailRenderer(
    createEmailTemplateRegistry(EMAIL_TEMPLATES, EMAIL_KINDS),
  );
}

function hrefsOf(html: string): string[] {
  return [...html.matchAll(/href="([^"]*)"/gu)].map(([, href]) => href ?? '');
}

describe('問い合わせの返信の通知のテンプレート', () => {
  test('種別に対応し、全テンプレートの集約点から種別の名前で引ける', () => {
    const registry = createEmailTemplateRegistry(EMAIL_TEMPLATES, EMAIL_KINDS);

    expect(INQUIRY_REPLY_TEMPLATE.kind).toBe(INQUIRY_REPLY_NOTIFICATION_KIND);
    expect(registry.get('inquiry.reply-notification')).toBe(
      INQUIRY_REPLY_TEMPLATE,
    );
  });

  test('文言規則の件名を接頭辞なしで返し、受信一覧の冒頭の文を持つ', () => {
    expect(INQUIRY_REPLY_TEMPLATE.subject(INPUT)).toBe(SUBJECT);
    expect(INQUIRY_REPLY_TEMPLATE.preview(INPUT)).not.toBe('');
  });

  test('宛名にニックネームを使い、行動ボタン「問い合わせを確認する」でチャットページへリンクする', () => {
    expect(INQUIRY_REPLY_TEMPLATE.greeting(INPUT)).toBe(NICKNAME);
    expect(INQUIRY_REPLY_TEMPLATE.action?.(INPUT)).toEqual({
      label: ACTION_LABEL,
      url: INQUIRY_URL,
    });
  });

  test('配信停止の区画を持たない', () => {
    expect('unsubscribeLinks' in INQUIRY_REPLY_TEMPLATE).toBe(false);
  });

  test('HTMLのパートに宛名・time要素で包んだUTCの返信の日時・案内・チャットページへの行動ボタンだけを置く', async () => {
    const rendered = await createRenderer().render(
      INQUIRY_REPLY_NOTIFICATION_KIND,
      INPUT,
      undefined,
    );

    expect(rendered.subject).toBe(SUBJECT);
    expect(rendered.html).toContain(`${NICKNAME}さん`);
    expect(rendered.html).toMatch(
      /<time datetime="2026-11-02T07:40:00\.000Z">11月2日07:40\(UTC\)<\/time>に、お問い合わせへの返信がありました。/iu,
    );
    expect(rendered.html).toContain(GUIDANCE);
    expect(rendered.html).toContain(ACTION_LABEL);
    expect(hrefsOf(rendered.html)).toEqual([INQUIRY_URL]);
    expect(rendered.html).not.toContain('<!-- -->');
  });

  test('テキストのパートにも宛名・UTCの返信の日時・案内・行動ボタンの文言とURLを置く', async () => {
    const rendered = await createRenderer().render(
      INQUIRY_REPLY_NOTIFICATION_KIND,
      INPUT,
      undefined,
    );

    expect(rendered.text).toContain(`${NICKNAME}さん`);
    expect(rendered.text).toContain(
      '11月2日07:40(UTC)に、お問い合わせへの返信がありました。',
    );
    expect(rendered.text).toContain(GUIDANCE);
    expect(rendered.text).toContain(ACTION_LABEL);
    expect(rendered.text).toContain(INQUIRY_URL);
    expect(rendered.text).not.toMatch(/<[a-z]/iu);
  });

  test('入力に返信の本文が紛れ込んでもメールのどのパートにも載せない', async () => {
    const rendered = await createRenderer().render(
      INQUIRY_REPLY_NOTIFICATION_KIND,
      { ...INPUT, body: REPLY_BODY },
      undefined,
    );

    expect(rendered.subject).not.toContain(REPLY_BODY);
    expect(rendered.html).not.toContain(REPLY_BODY);
    expect(rendered.text).not.toContain(REPLY_BODY);
  });

  test('ニックネームの<script>をHTMLとして解釈させない', async () => {
    const rendered = await createRenderer().render(
      INQUIRY_REPLY_NOTIFICATION_KIND,
      { ...INPUT, nickname: '<script>alert(1)</script>' },
      undefined,
    );

    expect(rendered.html).not.toMatch(/<script\b/iu);
    expect(rendered.html).toContain(
      '&lt;script&gt;alert(1)&lt;/script&gt;さん',
    );
  });
});
