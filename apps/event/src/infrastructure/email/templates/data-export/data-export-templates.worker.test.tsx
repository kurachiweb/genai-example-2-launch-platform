import { describe, expect, test } from 'vitest';

import {
  DATA_EXPORT_ARCHIVE_FAILED_EMAIL,
  DATA_EXPORT_ARCHIVE_READY_EMAIL,
} from '../../../../../lib/core/email/kinds/data-export.ts';
import { EMAIL_KINDS } from '../../../../../lib/core/email/kinds/index.ts';
import { createEmailTemplateRegistry } from '../../rendering/email-template.ts';
import { ReactEmailRenderer } from '../../rendering/react-email-renderer.tsx';
import { EMAIL_TEMPLATES } from '../index.ts';
import { DATA_EXPORT_ARCHIVE_FAILED_TEMPLATE } from './archive-failed-template.ts';
import { DATA_EXPORT_ARCHIVE_READY_TEMPLATE } from './archive-ready-template.ts';
import { DATA_EXPORT_EMAIL_TEMPLATES } from './index.ts';

const NICKNAME = '山田 はなこ';

const PAGE_URL = 'https://client.example/settings/export';

const CONTACT_URL = 'https://client.example/contact';

const REQUESTED_AT = '2026-11-20T07:40:00.000Z';

const REQUESTED_AT_TEXT = '2026年11月20日07:40(UTC)';

const EXPIRES_AT = '2026-11-27T07:44:00.000Z';

const EXPIRES_AT_TEXT = '2026年11月27日07:44(UTC)';

const READY_SUBJECT = 'データエクスポートの準備ができました';

const FAILED_SUBJECT = 'データエクスポートに失敗しました';

const READY_ACTION_LABEL = 'ダウンロードページを開く';

const CONTACT_LABEL = 'お問い合わせ';

const READY_LEAD = 'ご要求いただいたデータエクスポートの準備ができました。';

const READY_GUIDE =
  '下のボタンからダウンロードページを開き、ログインしてダウンロードしてください。';

const ERROR_LEAD =
  'データエクスポートに失敗しました。準備中に問題が発生し、ZIPファイルを作成できませんでした。';

const TOO_LARGE_LEAD =
  'データエクスポートに失敗しました。データが大きすぎるため、ZIPファイルを作成できませんでした。';

const TOO_LARGE_CONTACT_GUIDE =
  'お手数ですが、下のボタンからお問い合わせください。';

const PAGE_LINK_LABEL = 'データエクスポートのページを開く';

const ERROR_CONTACT_GUIDE =
  'ご不明な点がある場合は、下のボタンからお問い合わせください。';

const RE_REQUEST_SENTENCE =
  'もう一度要求する場合は、次のページから操作してください。失敗した要求も、24時間に3回までの要求の回数に含まれます。';

const UNSUBSCRIBE_LABEL = '配信停止';

const READY_INPUT = {
  nickname: NICKNAME,
  requestedAt: REQUESTED_AT,
  expiresAt: EXPIRES_AT,
  pageUrl: PAGE_URL,
};

const FAILED_INPUT = {
  nickname: NICKNAME,
  requestedAt: REQUESTED_AT,
  reason: 'error' as const,
  pageUrl: PAGE_URL,
  contactUrl: CONTACT_URL,
};

function createRenderer(): ReactEmailRenderer {
  return new ReactEmailRenderer(
    createEmailTemplateRegistry(EMAIL_TEMPLATES, EMAIL_KINDS),
  );
}

function hrefsOf(html: string): string[] {
  return [...html.matchAll(/href="([^"]*)"/gu)].map(([, href]) => href ?? '');
}

function renderReady(input: Record<string, unknown> = READY_INPUT) {
  return createRenderer().render(
    DATA_EXPORT_ARCHIVE_READY_EMAIL,
    input,
    undefined,
  );
}

function renderFailed(input: Record<string, unknown> = FAILED_INPUT) {
  return createRenderer().render(
    DATA_EXPORT_ARCHIVE_FAILED_EMAIL,
    input,
    undefined,
  );
}

describe('データエクスポートのテンプレートの集約', () => {
  test('完了と失敗のテンプレートをこの順で凍結して持ち、それぞれ対応するトランザクションメールの種別を指す', () => {
    expect(DATA_EXPORT_EMAIL_TEMPLATES).toEqual([
      DATA_EXPORT_ARCHIVE_READY_TEMPLATE,
      DATA_EXPORT_ARCHIVE_FAILED_TEMPLATE,
    ]);
    expect(Object.isFrozen(DATA_EXPORT_EMAIL_TEMPLATES)).toBe(true);
    expect(DATA_EXPORT_ARCHIVE_READY_TEMPLATE.kind).toBe(
      DATA_EXPORT_ARCHIVE_READY_EMAIL,
    );
    expect(DATA_EXPORT_ARCHIVE_FAILED_TEMPLATE.kind).toBe(
      DATA_EXPORT_ARCHIVE_FAILED_EMAIL,
    );
  });

  test('全テンプレートの集約点から種別の名前で引ける', () => {
    const registry = createEmailTemplateRegistry(EMAIL_TEMPLATES, EMAIL_KINDS);

    expect(registry.get('data-export.archive-ready')).toBe(
      DATA_EXPORT_ARCHIVE_READY_TEMPLATE,
    );
    expect(registry.get('data-export.archive-failed')).toBe(
      DATA_EXPORT_ARCHIVE_FAILED_TEMPLATE,
    );
  });

  test('配信停止の区画を持たない', () => {
    expect('unsubscribeLinks' in DATA_EXPORT_ARCHIVE_READY_TEMPLATE).toBe(
      false,
    );
    expect('unsubscribeLinks' in DATA_EXPORT_ARCHIVE_FAILED_TEMPLATE).toBe(
      false,
    );
  });
});

describe('データエクスポートの完了のテンプレート', () => {
  test('件名を接頭辞なしで返し、宛名にニックネームを使い、行動ボタンでダウンロードページへリンクする', () => {
    expect(DATA_EXPORT_ARCHIVE_READY_TEMPLATE.subject(READY_INPUT)).toBe(
      READY_SUBJECT,
    );
    expect(DATA_EXPORT_ARCHIVE_READY_TEMPLATE.greeting(READY_INPUT)).toBe(
      NICKNAME,
    );
    expect(DATA_EXPORT_ARCHIVE_READY_TEMPLATE.action?.(READY_INPUT)).toEqual({
      label: READY_ACTION_LABEL,
      url: PAGE_URL,
    });
    expect(DATA_EXPORT_ARCHIVE_READY_TEMPLATE.preview(READY_INPUT)).toBe(
      READY_LEAD,
    );
  });

  test('HTMLのパートに宛名・要求日時と有効期限のUTC表記・ダウンロードページへのボタンだけを置く', async () => {
    const rendered = await renderReady();

    expect(rendered.subject).toBe(READY_SUBJECT);
    expect(rendered.html).toContain(`${NICKNAME}さん`);
    expect(rendered.html).toContain(READY_LEAD);
    expect(rendered.html).toContain(READY_GUIDE);
    expect(rendered.html).toContain(READY_ACTION_LABEL);
    expect(rendered.html).toContain(
      `<time dateTime="${REQUESTED_AT}">${REQUESTED_AT_TEXT}</time>`,
    );
    expect(rendered.html).toContain(
      `<time dateTime="${EXPIRES_AT}">${EXPIRES_AT_TEXT}</time>`,
    );
    expect(rendered.html).toContain('までダウンロードできます');
    expect(hrefsOf(rendered.html)).toEqual([PAGE_URL]);
    expect(rendered.html).not.toContain(UNSUBSCRIBE_LABEL);
    expect(rendered.html).not.toContain('<!-- -->');
  });

  test('テキストのパートにも宛名・日時・ボタンの文言とページのURLを置き、配信停止のリンクを置かない', async () => {
    const rendered = await renderReady();

    for (const part of [
      `${NICKNAME}さん`,
      READY_LEAD,
      REQUESTED_AT_TEXT,
      EXPIRES_AT_TEXT,
      READY_GUIDE,
      READY_ACTION_LABEL,
      PAGE_URL,
    ]) {
      expect(rendered.text).toContain(part);
    }
    expect(rendered.text).not.toContain(UNSUBSCRIBE_LABEL);
    expect(rendered.text).not.toMatch(/<[a-z]/iu);
  });

  test('ダウンロードの経路とZIPそのもののURLを載せない', async () => {
    const rendered = await renderReady({
      ...READY_INPUT,
      downloadUrl:
        'https://client.example/_bff/exports/01JD0PR0D0000000000000000A',
    });

    for (const part of [rendered.html, rendered.text]) {
      expect(part).not.toContain('/_bff/exports');
      expect(part).not.toContain('downloadUrl');
      expect(part).not.toMatch(/\.zip/iu);
    }
  });

  test('利用者の値に含まれる<script>をHTMLとして解釈させない', async () => {
    const rendered = await renderReady({
      ...READY_INPUT,
      nickname: '<script>alert(1)</script>',
    });

    expect(rendered.html).not.toMatch(/<script\b/iu);
    expect(rendered.html).toContain(
      '&lt;script&gt;alert(1)&lt;/script&gt;さん',
    );
  });
});

describe('データエクスポートの失敗のテンプレート', () => {
  test('件名を接頭辞なしで返し、宛名にニックネームを使い、行動ボタンで問い合わせへリンクする', () => {
    expect(DATA_EXPORT_ARCHIVE_FAILED_TEMPLATE.subject(FAILED_INPUT)).toBe(
      FAILED_SUBJECT,
    );
    expect(DATA_EXPORT_ARCHIVE_FAILED_TEMPLATE.greeting(FAILED_INPUT)).toBe(
      NICKNAME,
    );
    expect(DATA_EXPORT_ARCHIVE_FAILED_TEMPLATE.action?.(FAILED_INPUT)).toEqual({
      label: CONTACT_LABEL,
      url: CONTACT_URL,
    });
  });

  test('受信一覧の冒頭の文は失敗の種類に応じた本文の最初の文と同じである', () => {
    expect(DATA_EXPORT_ARCHIVE_FAILED_TEMPLATE.preview(FAILED_INPUT)).toBe(
      ERROR_LEAD,
    );
    expect(
      DATA_EXPORT_ARCHIVE_FAILED_TEMPLATE.preview({
        ...FAILED_INPUT,
        reason: 'too_large',
      }),
    ).toBe(TOO_LARGE_LEAD);
  });

  test('失敗の種類がerrorなら、失敗した旨・要求日時・再要求の案内と回数に含まれる旨・問い合わせのボタンを置き、大きすぎる旨を置かない', async () => {
    const rendered = await renderFailed();

    expect(rendered.subject).toBe(FAILED_SUBJECT);
    for (const part of [rendered.html, rendered.text]) {
      expect(part).toContain(`${NICKNAME}さん`);
      expect(part).toContain(ERROR_LEAD);
      expect(part).toContain(RE_REQUEST_SENTENCE);
      expect(part).toContain(PAGE_LINK_LABEL);
      expect(part).toContain(ERROR_CONTACT_GUIDE);
      expect(part).toContain(CONTACT_LABEL);
      expect(part).not.toContain('大きすぎる');
      expect(part).not.toContain(TOO_LARGE_CONTACT_GUIDE);
      expect(part).not.toContain(UNSUBSCRIBE_LABEL);
    }
    expect(rendered.html).toContain(
      `<time dateTime="${REQUESTED_AT}">${REQUESTED_AT_TEXT}</time>`,
    );
    expect(rendered.text).toContain(REQUESTED_AT_TEXT);
    expect(hrefsOf(rendered.html).toSorted()).toEqual(
      [CONTACT_URL, PAGE_URL].toSorted(),
    );
    expect(rendered.text).toContain(PAGE_URL);
    expect(rendered.text).toContain(CONTACT_URL);
    expect(rendered.html).not.toContain('<!-- -->');
  });

  test('失敗の種類がtoo_largeなら、大きすぎるため作成できなかった旨と問い合わせを求める旨を加える', async () => {
    const rendered = await renderFailed({
      ...FAILED_INPUT,
      reason: 'too_large',
    });

    for (const part of [rendered.html, rendered.text]) {
      expect(part).toContain(TOO_LARGE_LEAD);
      expect(part).toContain(TOO_LARGE_CONTACT_GUIDE);
      expect(part).toContain(RE_REQUEST_SENTENCE);
      expect(part).toContain(PAGE_LINK_LABEL);
      expect(part).not.toContain(ERROR_CONTACT_GUIDE);
      expect(part).not.toContain(ERROR_LEAD);
    }
    expect(hrefsOf(rendered.html).toSorted()).toEqual(
      [CONTACT_URL, PAGE_URL].toSorted(),
    );
  });

  test('ダウンロードの経路を載せず、利用者の値に含まれる<script>をHTMLとして解釈させない', async () => {
    const rendered = await renderFailed({
      ...FAILED_INPUT,
      nickname: '<script>alert(1)</script>',
    });

    expect(rendered.html).not.toMatch(/<script\b/iu);
    expect(rendered.html).toContain(
      '&lt;script&gt;alert(1)&lt;/script&gt;さん',
    );
    for (const part of [rendered.html, rendered.text]) {
      expect(part).not.toContain('/_bff/exports');
    }
  });
});
