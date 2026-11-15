import { describe, expect, test } from 'vitest';

import type { AnyEmailKind } from '../../../../../lib/core/email/email-kind.ts';
import {
  ADMIN_EMAIL_CHANGE_CONFIRMATION_KIND,
  ADMIN_EMAIL_CHANGED_KIND,
  ADMIN_EMAIL_KINDS,
  ADMIN_INVITATION_KIND,
  ADMIN_PASSWORD_CHANGED_KIND,
  ADMIN_PASSWORD_RESET_COMPLETED_KIND,
  ADMIN_PASSWORD_RESET_KIND,
} from '../../../../../lib/core/email/kinds/admin.ts';
import { EMAIL_KINDS } from '../../../../../lib/core/email/kinds/index.ts';
import {
  createEmailTemplateRegistry,
  type EmailTemplate,
} from '../../rendering/email-template.ts';
import { ReactEmailRenderer } from '../../rendering/react-email-renderer.tsx';
import { EMAIL_TEMPLATES } from '../index.ts';
import { ADMIN_EMAIL_CHANGE_CONFIRMATION_TEMPLATE } from './admin-email-change-confirmation-template.ts';
import { ADMIN_EMAIL_CHANGED_TEMPLATE } from './admin-email-changed-template.ts';
import { ADMIN_INVITATION_TEMPLATE } from './admin-invitation-template.ts';
import { ADMIN_PASSWORD_CHANGED_TEMPLATE } from './admin-password-changed-template.ts';
import { ADMIN_PASSWORD_RESET_COMPLETED_TEMPLATE } from './admin-password-reset-completed-template.ts';
import { ADMIN_PASSWORD_RESET_TEMPLATE } from './admin-password-reset-template.ts';
import { ADMIN_EMAIL_TEMPLATES } from './index.ts';

const NICKNAME = '運営 はなこ';

const AT = '2026-11-02T07:40:00.000Z';

const AT_TEXT = '11月2日07:40(UTC)';

interface Action {
  readonly label: string;
  readonly url: string;
}

interface TemplateCase {
  readonly title: string;
  readonly template: EmailTemplate<unknown>;
  readonly kind: AnyEmailKind;
  readonly input: Record<string, string>;
  readonly subject: string;
  readonly greeting: string | undefined;
  readonly action: Action | undefined;
  readonly sentences: readonly string[];
  readonly timeSentence: RegExp;
  readonly unrecognizedNotice: string;
}

const UNRECOGNIZED_CHANGE_NOTICE =
  'お心当たりが無い場合は、第三者に管理者アカウントを操作されたおそれがあります。すぐに他の管理者へ連絡してください。';

function linkTimeSentence(afterExpiry: string): RegExp {
  return new RegExp(
    `リンクの有効期限は<time datetime="2026-11-02T07:40:00\\.000Z">11月2日07:40\\(UTC\\)</time>です。${afterExpiry}`,
    'iu',
  );
}

function completedTimeSentence(prefix: string, suffix: string): RegExp {
  return new RegExp(
    `${prefix}<time datetime="2026-11-02T07:40:00\\.000Z">11月2日07:40\\(UTC\\)</time>${suffix}`,
    'iu',
  );
}

const TEMPLATE_CASES: readonly TemplateCase[] = [
  {
    title: '招待',
    template: ADMIN_INVITATION_TEMPLATE,
    kind: ADMIN_INVITATION_KIND,
    input: {
      invitationUrl: 'https://admin.example/auth/invitation#token=invite-token',
      expiresAt: AT,
    },
    subject: '管理者アカウントの設定を完了してください',
    greeting: undefined,
    action: {
      label: '招待を受けて設定する',
      url: 'https://admin.example/auth/invitation#token=invite-token',
    },
    sentences: [
      '管理者アカウントに招待されました。下のボタンからニックネーム・パスワード・認証アプリを設定すると、管理画面を使えるようになります。',
    ],
    timeSentence: linkTimeSentence(
      '期限を過ぎた場合は、招待した管理者に招待の再送を依頼してください。',
    ),
    unrecognizedNotice:
      'このメールにお心当たりが無い場合は、何もしなくて構いません。設定を完了しない限り、管理者アカウントは使えるようになりません。',
  },
  {
    title: 'メールアドレス変更の確認',
    template: ADMIN_EMAIL_CHANGE_CONFIRMATION_TEMPLATE,
    kind: ADMIN_EMAIL_CHANGE_CONFIRMATION_KIND,
    input: {
      nickname: NICKNAME,
      confirmUrl:
        'https://admin.example/auth/email-change/confirm#token=email-token',
      expiresAt: AT,
    },
    subject: '管理者アカウントの新しいメールアドレスを確認してください',
    greeting: NICKNAME,
    action: {
      label: 'メールアドレスの変更を確定する',
      url: 'https://admin.example/auth/email-change/confirm#token=email-token',
    },
    sentences: [
      '管理者アカウントのメールアドレスをこのメールアドレスへ変更する手続きを受け付けました。下のボタンから変更を確定してください。',
    ],
    timeSentence: linkTimeSentence(
      '期限を過ぎた場合は、もう一度手続きをしてください。',
    ),
    unrecognizedNotice:
      'このメールにお心当たりが無い場合は、何もしなくて構いません。メールアドレスは変更されません。',
  },
  {
    title: 'メールアドレス変更完了',
    template: ADMIN_EMAIL_CHANGED_TEMPLATE,
    kind: ADMIN_EMAIL_CHANGED_KIND,
    input: { nickname: NICKNAME, changedAt: AT },
    subject: '管理者アカウントのメールアドレスが変更されました',
    greeting: NICKNAME,
    action: undefined,
    sentences: ['このメールは変更前のメールアドレスにお送りしています。'],
    timeSentence: completedTimeSentence(
      '管理者アカウントのメールアドレスが',
      'に変更されました。',
    ),
    unrecognizedNotice: UNRECOGNIZED_CHANGE_NOTICE,
  },
  {
    title: 'パスワードリセット',
    template: ADMIN_PASSWORD_RESET_TEMPLATE,
    kind: ADMIN_PASSWORD_RESET_KIND,
    input: {
      nickname: NICKNAME,
      resetUrl:
        'https://admin.example/auth/password-reset/confirm#token=reset-token',
      expiresAt: AT,
    },
    subject: '管理者アカウントのパスワードを再設定してください',
    greeting: NICKNAME,
    action: {
      label: 'パスワードを再設定する',
      url: 'https://admin.example/auth/password-reset/confirm#token=reset-token',
    },
    sentences: [
      '管理者アカウントのパスワードの再設定の手続きを受け付けました。下のボタンから新しいパスワードを設定してください。',
    ],
    timeSentence: linkTimeSentence(
      '期限を過ぎた場合は、もう一度手続きをしてください。',
    ),
    unrecognizedNotice:
      'このメールにお心当たりが無い場合は、何もしなくて構いません。パスワードは変更されません。',
  },
  {
    title: 'パスワードリセット完了',
    template: ADMIN_PASSWORD_RESET_COMPLETED_TEMPLATE,
    kind: ADMIN_PASSWORD_RESET_COMPLETED_KIND,
    input: { nickname: NICKNAME, completedAt: AT },
    subject: '管理者アカウントのパスワードが再設定されました',
    greeting: NICKNAME,
    action: undefined,
    sentences: [],
    timeSentence: completedTimeSentence(
      '管理者アカウントのパスワードが',
      'に再設定されました。',
    ),
    unrecognizedNotice: UNRECOGNIZED_CHANGE_NOTICE,
  },
  {
    title: 'パスワード変更完了',
    template: ADMIN_PASSWORD_CHANGED_TEMPLATE,
    kind: ADMIN_PASSWORD_CHANGED_KIND,
    input: { nickname: NICKNAME, changedAt: AT },
    subject: '管理者アカウントのパスワードが変更されました',
    greeting: NICKNAME,
    action: undefined,
    sentences: [],
    timeSentence: completedTimeSentence(
      '管理者アカウントのパスワードが',
      'に変更されました。',
    ),
    unrecognizedNotice: UNRECOGNIZED_CHANGE_NOTICE,
  },
];

function createRenderer(): ReactEmailRenderer {
  return new ReactEmailRenderer(
    createEmailTemplateRegistry(EMAIL_TEMPLATES, EMAIL_KINDS),
  );
}

function hrefsOf(html: string): string[] {
  return [...html.matchAll(/href="([^"]*)"/gu)].map(([, href]) => href ?? '');
}

describe('管理者のテンプレートの集約', () => {
  test('管理者の6種の種別と1対1で、種別の順に並ぶ', () => {
    expect(ADMIN_EMAIL_TEMPLATES.map((template) => template.kind)).toEqual(
      ADMIN_EMAIL_KINDS,
    );
    expect(Object.isFrozen(ADMIN_EMAIL_TEMPLATES)).toBe(true);
  });

  test('管理者の種別だけの集約で例外なくテンプレートを登録できる', () => {
    expect(() =>
      createEmailTemplateRegistry(ADMIN_EMAIL_TEMPLATES, ADMIN_EMAIL_KINDS),
    ).not.toThrow();
  });

  test('全テンプレートの集約点から管理者の6種を種別の名前で引ける', () => {
    const registry = createEmailTemplateRegistry(EMAIL_TEMPLATES, EMAIL_KINDS);

    for (const template of ADMIN_EMAIL_TEMPLATES) {
      expect(registry.get(template.kind.name)).toBe(template);
    }
  });
});

describe.each(TEMPLATE_CASES)('$titleのテンプレート', (testCase) => {
  test('種別に対応し、文言規則の件名を接頭辞なしで返す', () => {
    expect(testCase.template.kind).toBe(testCase.kind);
    expect(testCase.template.subject(testCase.input)).toBe(testCase.subject);
    expect(testCase.template.preview(testCase.input)).not.toBe('');
  });

  test('宛名と行動ボタンを文言規則の構成どおりに返す', () => {
    expect(testCase.template.greeting(testCase.input)).toBe(testCase.greeting);
    expect(testCase.template.action?.(testCase.input)).toEqual(testCase.action);
  });

  test('HTMLのパートに宛名・行動ボタン・time要素で包んだUTCの日時・心当たりが無い場合の案内を置く', async () => {
    const rendered = await createRenderer().render(
      testCase.kind,
      testCase.input,
      undefined,
    );

    expect(rendered.subject).toBe(testCase.subject);
    if (testCase.greeting === undefined) {
      expect(rendered.html).not.toContain('さん');
    } else {
      expect(rendered.html).toContain(`${testCase.greeting}さん`);
    }
    expect(hrefsOf(rendered.html)).toEqual(
      testCase.action === undefined ? [] : [testCase.action.url],
    );
    if (testCase.action !== undefined) {
      expect(rendered.html).toContain(testCase.action.label);
    }
    for (const sentence of testCase.sentences) {
      expect(rendered.html).toContain(sentence);
    }
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

    if (testCase.greeting !== undefined) {
      expect(rendered.text).toContain(`${testCase.greeting}さん`);
    }
    if (testCase.action !== undefined) {
      expect(rendered.text).toContain(testCase.action.label);
      expect(rendered.text).toContain(testCase.action.url);
    }
    expect(rendered.text).toContain(AT_TEXT);
    expect(rendered.text).toContain(testCase.unrecognizedNotice);
    expect(rendered.text).not.toMatch(/<[a-z]/iu);
  });
});

describe.each(TEMPLATE_CASES.filter(({ greeting }) => greeting !== undefined))(
  '宛名を持つ$titleのテンプレート',
  (testCase) => {
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
  },
);
