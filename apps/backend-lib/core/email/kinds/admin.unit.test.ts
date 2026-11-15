import { describe, expect, test } from 'bun:test';

import { type AnyEmailKind, createEmailKindRegistry } from '../email-kind.ts';
import {
  ADMIN_EMAIL_CHANGE_CONFIRMATION_KIND,
  ADMIN_EMAIL_CHANGED_KIND,
  ADMIN_EMAIL_KINDS,
  ADMIN_INVITATION_KIND,
  ADMIN_PASSWORD_CHANGED_KIND,
  ADMIN_PASSWORD_RESET_COMPLETED_KIND,
  ADMIN_PASSWORD_RESET_KIND,
} from './admin.ts';

const LINK_URL = 'https://admin.example/auth/invitation#token=abc123';

const AT = '2026-11-02T07:40:00.000Z';

interface KindCase {
  readonly kind: AnyEmailKind;
  readonly name: string;
  readonly fields: Readonly<Record<string, string>>;
  readonly urlKey?: string;
  readonly atKey: string;
}

const KIND_CASES: readonly KindCase[] = [
  {
    kind: ADMIN_INVITATION_KIND,
    name: 'admin.invitation',
    fields: { invitationUrl: LINK_URL, expiresAt: AT },
    urlKey: 'invitationUrl',
    atKey: 'expiresAt',
  },
  {
    kind: ADMIN_EMAIL_CHANGE_CONFIRMATION_KIND,
    name: 'admin.email-change-confirmation',
    fields: { nickname: '山田', confirmUrl: LINK_URL, expiresAt: AT },
    urlKey: 'confirmUrl',
    atKey: 'expiresAt',
  },
  {
    kind: ADMIN_EMAIL_CHANGED_KIND,
    name: 'admin.email-changed',
    fields: { nickname: '山田', changedAt: AT },
    atKey: 'changedAt',
  },
  {
    kind: ADMIN_PASSWORD_RESET_KIND,
    name: 'admin.password-reset',
    fields: { nickname: '山田', resetUrl: LINK_URL, expiresAt: AT },
    urlKey: 'resetUrl',
    atKey: 'expiresAt',
  },
  {
    kind: ADMIN_PASSWORD_RESET_COMPLETED_KIND,
    name: 'admin.password-reset-completed',
    fields: { nickname: '山田', completedAt: AT },
    atKey: 'completedAt',
  },
  {
    kind: ADMIN_PASSWORD_CHANGED_KIND,
    name: 'admin.password-changed',
    fields: { nickname: '山田', changedAt: AT },
    atKey: 'changedAt',
  },
];

const LINK_CASES = KIND_CASES.filter(
  (kindCase): kindCase is KindCase & { readonly urlKey: string } =>
    kindCase.urlKey !== undefined,
);

const NICKNAME_CASES = KIND_CASES.filter(({ fields }) => 'nickname' in fields);

function withField(
  fields: Readonly<Record<string, string>>,
  key: string,
  value: unknown,
): Record<string, unknown> {
  return { ...fields, [key]: value };
}

describe('ADMIN_EMAIL_KINDS', () => {
  test('管理者の6種を設計の順に並べ、凍結している', () => {
    expect(ADMIN_EMAIL_KINDS.map((kind) => kind.name)).toEqual(
      KIND_CASES.map(({ name }) => name),
    );
    expect(Object.isFrozen(ADMIN_EMAIL_KINDS)).toBe(true);
  });

  test('6種を例外なく種別の集約に登録できる', () => {
    const registry = createEmailKindRegistry(ADMIN_EMAIL_KINDS);

    expect(registry.names()).toEqual(KIND_CASES.map(({ name }) => name));
  });
});

describe.each(KIND_CASES)(
  'メール種別$name',
  ({ kind, name, fields, atKey }) => {
    test('トランザクションメールの凍結した種別である', () => {
      expect(kind.name).toBe(name);
      expect(kind.category).toBe('transactional');
      expect(Object.isFrozen(kind)).toBe(true);
    });

    test('定めた項目を受け付け、他の項目を取り除く', () => {
      const result = kind.inputSchema.safeParse({
        ...fields,
        to: 'someone@mail.example',
        token: 'plain-token',
      });

      expect(result).toEqual({ success: true, data: fields });
    });

    test('検証した結果をもう一度検証しても同じ値になる', () => {
      const first = kind.inputSchema.parse(fields);

      expect(kind.inputSchema.parse(first)).toEqual(first);
    });

    test.each([
      '',
      '2026-11-02',
      '2026-11-02T16:40:00+09:00',
      '2026-13-01T00:00:00Z',
      '明日',
      1_793_000_000_000,
      new Date(AT),
      undefined,
    ])('日時がUTCのISO 8601形式でない入力%pを拒否する', (at) => {
      expect(
        kind.inputSchema.safeParse(withField(fields, atKey, at)).success,
      ).toBe(false);
    });
  },
);

describe('招待の種別', () => {
  test('宛名を持たず、ニックネームを渡しても取り除く', () => {
    const result = ADMIN_INVITATION_KIND.inputSchema.safeParse({
      invitationUrl: LINK_URL,
      expiresAt: AT,
      nickname: '山田',
    });

    expect(result).toEqual({
      success: true,
      data: { invitationUrl: LINK_URL, expiresAt: AT },
    });
  });
});

describe.each(LINK_CASES)(
  'リンクを含むメール種別$name',
  ({ kind, fields, urlKey }) => {
    test.each([
      'https://admin.example/auth/password-reset/confirm#token=abc',
      'http://localhost:48045/auth/invitation#token=abc',
    ])('URL%sを受け付ける', (url) => {
      expect(
        kind.inputSchema.safeParse(withField(fields, urlKey, url)).success,
      ).toBe(true);
    });

    test.each([
      '',
      'admin.example/auth/invitation',
      'http://admin.example/auth/invitation',
      'http://localhost.admin.example/auth/invitation',
      'http://localhost@admin.example/auth/invitation',
      'http://127.0.0.1:48045/auth/invitation',
      'javascript:alert(1)',
      '/auth/invitation',
      1,
      undefined,
    ])('https:かhttp://localhostで始まらないURL%pを拒否する', (url) => {
      expect(
        kind.inputSchema.safeParse(withField(fields, urlKey, url)).success,
      ).toBe(false);
    });
  },
);

describe.each(NICKNAME_CASES)(
  '宛名を持つメール種別$name',
  ({ kind, fields }) => {
    test.each(['', undefined, null, 1])(
      'ニックネーム%pを拒否する',
      (nickname) => {
        expect(
          kind.inputSchema.safeParse(withField(fields, 'nickname', nickname))
            .success,
        ).toBe(false);
      },
    );
  },
);
