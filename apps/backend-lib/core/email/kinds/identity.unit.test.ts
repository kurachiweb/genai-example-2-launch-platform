import { describe, expect, test } from 'bun:test';

import { type AnyEmailKind, createEmailKindRegistry } from '../email-kind.ts';
import {
  IDENTITY_EMAIL_CHANGE_CONFIRMATION_KIND,
  IDENTITY_EMAIL_CHANGED_KIND,
  IDENTITY_EMAIL_KINDS,
  IDENTITY_EMAIL_VERIFICATION_KIND,
  IDENTITY_PASSWORD_CHANGE_CONFIRMATION_KIND,
  IDENTITY_PASSWORD_CHANGED_KIND,
  IDENTITY_PASSWORD_RESET_COMPLETED_KIND,
  IDENTITY_PASSWORD_RESET_KIND,
} from './identity.ts';

const LINK_URL = 'https://app.example/auth/verify-email#token=abc123';

const AT = '2026-11-02T07:40:00.000Z';

interface KindCase {
  readonly kind: AnyEmailKind;
  readonly name: string;
  readonly urlKey: string;
  readonly atKey: string;
}

const KIND_CASES: readonly KindCase[] = [
  {
    kind: IDENTITY_EMAIL_VERIFICATION_KIND,
    name: 'identity.email-verification',
    urlKey: 'verifyUrl',
    atKey: 'expiresAt',
  },
  {
    kind: IDENTITY_EMAIL_CHANGE_CONFIRMATION_KIND,
    name: 'identity.email-change-confirmation',
    urlKey: 'confirmUrl',
    atKey: 'expiresAt',
  },
  {
    kind: IDENTITY_EMAIL_CHANGED_KIND,
    name: 'identity.email-changed',
    urlKey: 'contactUrl',
    atKey: 'changedAt',
  },
  {
    kind: IDENTITY_PASSWORD_RESET_KIND,
    name: 'identity.password-reset',
    urlKey: 'resetUrl',
    atKey: 'expiresAt',
  },
  {
    kind: IDENTITY_PASSWORD_RESET_COMPLETED_KIND,
    name: 'identity.password-reset-completed',
    urlKey: 'contactUrl',
    atKey: 'completedAt',
  },
  {
    kind: IDENTITY_PASSWORD_CHANGE_CONFIRMATION_KIND,
    name: 'identity.password-change-confirmation',
    urlKey: 'confirmUrl',
    atKey: 'expiresAt',
  },
  {
    kind: IDENTITY_PASSWORD_CHANGED_KIND,
    name: 'identity.password-changed',
    urlKey: 'contactUrl',
    atKey: 'changedAt',
  },
];

function validInput(
  urlKey: string,
  atKey: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return { nickname: '山田', [urlKey]: LINK_URL, [atKey]: AT, ...overrides };
}

describe('IDENTITY_EMAIL_KINDS', () => {
  test('認証系の7種を設計の順に並べ、凍結している', () => {
    expect(IDENTITY_EMAIL_KINDS.map((kind) => kind.name)).toEqual(
      KIND_CASES.map(({ name }) => name),
    );
    expect(Object.isFrozen(IDENTITY_EMAIL_KINDS)).toBe(true);
  });

  test('7種を例外なく種別の集約に登録できる', () => {
    const registry = createEmailKindRegistry(IDENTITY_EMAIL_KINDS);

    expect(registry.names()).toEqual(KIND_CASES.map(({ name }) => name));
  });
});

describe.each(KIND_CASES)(
  'メール種別$name',
  ({ kind, name, urlKey, atKey }) => {
    test('トランザクションメールの凍結した種別である', () => {
      expect(kind.name).toBe(name);
      expect(kind.category).toBe('transactional');
      expect(Object.isFrozen(kind)).toBe(true);
    });

    test('ニックネーム・URL・UTCのISO 8601の日時を受け付け、他の項目を取り除く', () => {
      const result = kind.inputSchema.safeParse(
        validInput(urlKey, atKey, { to: 'someone@mail.example' }),
      );

      expect(result).toEqual({
        success: true,
        data: { nickname: '山田', [urlKey]: LINK_URL, [atKey]: AT },
      });
    });

    test('検証した結果をもう一度検証しても同じ値になる', () => {
      const first = kind.inputSchema.parse(validInput(urlKey, atKey));

      expect(kind.inputSchema.parse(first)).toEqual(first);
    });

    test.each([
      'https://app.example/auth/confirm#token=abc',
      'http://localhost:48040/auth/confirm#token=abc',
      'http://localhost/contact',
    ])('URL%sを受け付ける', (url) => {
      expect(
        kind.inputSchema.safeParse(validInput(urlKey, atKey, { [urlKey]: url }))
          .success,
      ).toBe(true);
    });

    test.each([
      '',
      'app.example/contact',
      'http://app.example/contact',
      'http://localhost.app.example/contact',
      'http://localhost@app.example/contact',
      'http://127.0.0.1:48040/contact',
      'ftp://app.example/contact',
      'javascript:alert(1)',
      'HTTPS://app.example/contact',
      '/contact',
      1,
      undefined,
    ])('https:かhttp://localhostで始まらないURL%pを拒否する', (url) => {
      expect(
        kind.inputSchema.safeParse(validInput(urlKey, atKey, { [urlKey]: url }))
          .success,
      ).toBe(false);
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
        kind.inputSchema.safeParse(validInput(urlKey, atKey, { [atKey]: at }))
          .success,
      ).toBe(false);
    });

    test.each(['', undefined, 1])('ニックネーム%pを拒否する', (nickname) => {
      expect(
        kind.inputSchema.safeParse(validInput(urlKey, atKey, { nickname }))
          .success,
      ).toBe(false);
    });
  },
);
