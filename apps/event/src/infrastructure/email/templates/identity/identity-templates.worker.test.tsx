import { describe, expect, test } from 'vitest';

import type { AnyEmailKind } from '../../../../../lib/core/email/email-kind.ts';
import {
  IDENTITY_EMAIL_CHANGE_CONFIRMATION_KIND,
  IDENTITY_EMAIL_CHANGED_KIND,
  IDENTITY_EMAIL_KINDS,
  IDENTITY_EMAIL_VERIFICATION_KIND,
  IDENTITY_PASSWORD_CHANGE_CONFIRMATION_KIND,
  IDENTITY_PASSWORD_CHANGED_KIND,
  IDENTITY_PASSWORD_RESET_COMPLETED_KIND,
  IDENTITY_PASSWORD_RESET_KIND,
} from '../../../../../lib/core/email/kinds/identity.ts';
import { EMAIL_KINDS } from '../../../../../lib/core/email/kinds/index.ts';
import {
  createEmailTemplateRegistry,
  type EmailTemplate,
} from '../../rendering/email-template.ts';
import { ReactEmailRenderer } from '../../rendering/react-email-renderer.tsx';
import { EMAIL_TEMPLATES } from '../index.ts';
import { EMAIL_CHANGE_CONFIRMATION_TEMPLATE } from './email-change-confirmation-template.ts';
import { EMAIL_CHANGED_TEMPLATE } from './email-changed-template.ts';
import { EMAIL_VERIFICATION_TEMPLATE } from './email-verification-template.ts';
import { IDENTITY_EMAIL_TEMPLATES } from './index.ts';
import { PASSWORD_CHANGE_CONFIRMATION_TEMPLATE } from './password-change-confirmation-template.ts';
import { PASSWORD_CHANGED_TEMPLATE } from './password-changed-template.ts';
import { PASSWORD_RESET_COMPLETED_TEMPLATE } from './password-reset-completed-template.ts';
import { PASSWORD_RESET_TEMPLATE } from './password-reset-template.ts';

const NICKNAME = '山田';

const AT = '2026-11-02T07:40:00.000Z';

const AT_TEXT = '11月2日07:40(UTC)';

const CONTACT_URL = 'https://app.example/contact';

interface TemplateCase {
  readonly title: string;
  readonly template: EmailTemplate<unknown>;
  readonly kind: AnyEmailKind;
  readonly input: Record<string, string>;
  readonly subject: string;
  readonly actionLabel: string;
  readonly actionUrl: string;
  readonly timeSentence: RegExp;
  readonly unrecognizedNotice: string;
}

const LINK_TIME_SENTENCE =
  /リンクの有効期限は<time datetime="2026-11-02T07:40:00\.000Z">11月2日07:40\(UTC\)<\/time>です。/iu;

const UNRECOGNIZED_CHANGE_NOTICE =
  'お心当たりが無い場合は、第三者にアカウントを操作されたおそれがあります。下のボタンからお問い合わせのうえ、ログイン画面の案内に従ってパスワードを再設定してください。';

function linkCase(
  title: string,
  template: EmailTemplate<unknown>,
  kind: AnyEmailKind,
  urlKey: string,
  url: string,
  subject: string,
  actionLabel: string,
  untouched: string,
): TemplateCase {
  return {
    title,
    template,
    kind,
    input: { nickname: NICKNAME, [urlKey]: url, expiresAt: AT },
    subject,
    actionLabel,
    actionUrl: url,
    timeSentence: LINK_TIME_SENTENCE,
    unrecognizedNotice: `このメールにお心当たりが無い場合は、何もしなくて構いません。${untouched}`,
  };
}

function completedCase(
  title: string,
  template: EmailTemplate<unknown>,
  kind: AnyEmailKind,
  atKey: string,
  subject: string,
  sentencePrefix: string,
): TemplateCase {
  return {
    title,
    template,
    kind,
    input: { nickname: NICKNAME, [atKey]: AT, contactUrl: CONTACT_URL },
    subject,
    actionLabel: 'お問い合わせ',
    actionUrl: CONTACT_URL,
    timeSentence: new RegExp(
      `${sentencePrefix}<time datetime="2026-11-02T07:40:00\\.000Z">11月2日07:40\\(UTC\\)</time>に`,
      'iu',
    ),
    unrecognizedNotice: UNRECOGNIZED_CHANGE_NOTICE,
  };
}

const TEMPLATE_CASES: readonly TemplateCase[] = [
  linkCase(
    '登録確認',
    EMAIL_VERIFICATION_TEMPLATE,
    IDENTITY_EMAIL_VERIFICATION_KIND,
    'verifyUrl',
    'https://app.example/auth/verify-email#token=verify-token',
    'あともう少し！メールアドレスを確認してください',
    'メールアドレスを確認する',
    'メールアドレスの確認は行われません。',
  ),
  linkCase(
    'メールアドレス変更の確認',
    EMAIL_CHANGE_CONFIRMATION_TEMPLATE,
    IDENTITY_EMAIL_CHANGE_CONFIRMATION_KIND,
    'confirmUrl',
    'https://app.example/auth/email-change/confirm#token=email-token',
    '新しいメールアドレスを確認してください',
    'メールアドレスの変更を確定する',
    'メールアドレスは変更されません。',
  ),
  completedCase(
    'メールアドレス変更完了',
    EMAIL_CHANGED_TEMPLATE,
    IDENTITY_EMAIL_CHANGED_KIND,
    'changedAt',
    'メールアドレスが変更されました',
    'アカウントのメールアドレスが',
  ),
  linkCase(
    'パスワードリセット',
    PASSWORD_RESET_TEMPLATE,
    IDENTITY_PASSWORD_RESET_KIND,
    'resetUrl',
    'https://app.example/auth/password-reset/confirm#token=reset-token',
    'パスワードを再設定してください',
    'パスワードを再設定する',
    'パスワードは変更されません。',
  ),
  completedCase(
    'パスワードリセット完了',
    PASSWORD_RESET_COMPLETED_TEMPLATE,
    IDENTITY_PASSWORD_RESET_COMPLETED_KIND,
    'completedAt',
    'パスワードが再設定されました',
    'アカウントのパスワードが',
  ),
  linkCase(
    'パスワード変更の確認',
    PASSWORD_CHANGE_CONFIRMATION_TEMPLATE,
    IDENTITY_PASSWORD_CHANGE_CONFIRMATION_KIND,
    'confirmUrl',
    'https://app.example/auth/password-change/confirm#token=password-token',
    'パスワードの変更を確認してください',
    'パスワードの変更を確定する',
    'パスワードは変更されません。',
  ),
  completedCase(
    'パスワード変更完了',
    PASSWORD_CHANGED_TEMPLATE,
    IDENTITY_PASSWORD_CHANGED_KIND,
    'changedAt',
    'パスワードが変更されました',
    'アカウントのパスワードが',
  ),
];

function createRenderer(): ReactEmailRenderer {
  return new ReactEmailRenderer(
    createEmailTemplateRegistry(EMAIL_TEMPLATES, EMAIL_KINDS),
  );
}

function hrefsOf(html: string): string[] {
  return [...html.matchAll(/href="([^"]*)"/gu)].map(([, href]) => href ?? '');
}

describe('認証系のテンプレートの集約', () => {
  test('認証系の7種の種別と1対1で、種別の順に並ぶ', () => {
    expect(IDENTITY_EMAIL_TEMPLATES.map((template) => template.kind)).toEqual(
      IDENTITY_EMAIL_KINDS,
    );
    expect(Object.isFrozen(IDENTITY_EMAIL_TEMPLATES)).toBe(true);
  });

  test('認証系の種別だけの集約で例外なくテンプレートを登録できる', () => {
    expect(() =>
      createEmailTemplateRegistry(
        IDENTITY_EMAIL_TEMPLATES,
        IDENTITY_EMAIL_KINDS,
      ),
    ).not.toThrow();
  });

  test('全テンプレートの集約点から認証系の7種を種別の名前で引ける', () => {
    const registry = createEmailTemplateRegistry(EMAIL_TEMPLATES, EMAIL_KINDS);

    for (const template of IDENTITY_EMAIL_TEMPLATES) {
      expect(registry.get(template.kind.name)).toBe(template);
    }
  });
});

describe.each(TEMPLATE_CASES)('$titleのテンプレート', (testCase) => {
  test('種別に対応し、文言規則の件名を接頭辞なしで返す', () => {
    expect(testCase.template.kind).toBe(testCase.kind);
    expect(testCase.template.subject(testCase.input)).toBe(testCase.subject);
  });

  test('宛名にニックネームを使い、行動ボタンに入力のURLを使う', () => {
    expect(testCase.template.greeting(testCase.input)).toBe(NICKNAME);
    expect(testCase.template.action?.(testCase.input)).toEqual({
      label: testCase.actionLabel,
      url: testCase.actionUrl,
    });
    expect(testCase.template.preview(testCase.input)).not.toBe('');
  });

  test('HTMLのパートに宛名・行動ボタン・time要素で包んだUTCの日時・心当たりが無い場合の案内を置く', async () => {
    const rendered = await createRenderer().render(
      testCase.kind,
      testCase.input,
      undefined,
    );

    expect(rendered.subject).toBe(testCase.subject);
    expect(rendered.html).toContain(`${NICKNAME}さん`);
    expect(rendered.html).toContain(testCase.actionLabel);
    expect(hrefsOf(rendered.html)).toEqual([testCase.actionUrl]);
    expect(rendered.html).toMatch(testCase.timeSentence);
    expect(rendered.html).toContain(testCase.unrecognizedNotice);
    expect(rendered.html).not.toContain('<!-- -->');
  });

  test('テキストのパートにも宛名・行動ボタンの文言とURL・UTCの日時・心当たりが無い場合の案内を置く', async () => {
    const rendered = await createRenderer().render(
      testCase.kind,
      testCase.input,
      undefined,
    );

    expect(rendered.text).toContain(`${NICKNAME}さん`);
    expect(rendered.text).toContain(testCase.actionLabel);
    expect(rendered.text).toContain(testCase.actionUrl);
    expect(rendered.text).toContain(AT_TEXT);
    expect(rendered.text).toContain(testCase.unrecognizedNotice);
    expect(rendered.text).not.toMatch(/<[a-z]/iu);
  });

  test('ニックネームの<script>をHTMLとして解釈させない', async () => {
    const nickname = '<script>alert(1)</script>';

    const rendered = await createRenderer().render(
      testCase.kind,
      { ...testCase.input, nickname },
      undefined,
    );

    expect(rendered.html).not.toMatch(/<script\b/iu);
    expect(rendered.html).toContain(
      '&lt;script&gt;alert(1)&lt;/script&gt;さん',
    );
  });
});
