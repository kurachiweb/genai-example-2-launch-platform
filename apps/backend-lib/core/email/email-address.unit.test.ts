import { describe, expect, test } from 'bun:test';

import {
  isValidEmailAddress,
  MAX_EMAIL_ADDRESS_LENGTH,
  toMatchingKey,
} from './email-address.ts';

const DOMAIN = '@mail.example';

describe('isValidEmailAddress', () => {
  test.each([
    'user@mail.example',
    'First.Last+tag@sub.mail.example',
    "o'neil@mail.example",
    'a.b-c_d!#$%&*/=?^`{|}~@mail.example',
    'user@mail-1.example',
    'user@localhost',
  ])('WHATWGの形式のメールアドレス%pを受け付ける', (address) => {
    expect(isValidEmailAddress(address)).toBe(true);
  });

  test('254文字のメールアドレスを受け付ける', () => {
    const address = `${'a'.repeat(MAX_EMAIL_ADDRESS_LENGTH - DOMAIN.length)}${DOMAIN}`;

    expect(address).toHaveLength(254);
    expect(isValidEmailAddress(address)).toBe(true);
  });

  test('255文字のメールアドレスを拒否する', () => {
    const address = `${'a'.repeat(MAX_EMAIL_ADDRESS_LENGTH + 1 - DOMAIN.length)}${DOMAIN}`;

    expect(address).toHaveLength(255);
    expect(isValidEmailAddress(address)).toBe(false);
  });

  test.each([
    '',
    'user',
    '@mail.example',
    'user@',
    'user@@mail.example',
    ' user@mail.example',
    'user@mail.example ',
    'user@mail.example\n',
    'user name@mail.example',
    'a@mail.example,b@mail.example',
    'a@mail.example; b@mail.example',
    'User <user@mail.example>',
    '"user"@mail.example',
    'user@-mail.example',
    'user@mail-.example',
    'user@mail_box.example',
    'user@mail..example',
    'user@[192.0.2.1]',
    `user@${'a'.repeat(64)}.example`,
    'ユーザー@mail.example',
    'user@メール.example',
  ])('WHATWGの形式でない、または1件でない宛先%pを拒否する', (address) => {
    expect(isValidEmailAddress(address)).toBe(false);
  });
});

describe('toMatchingKey', () => {
  test('前後の空白を除いて小文字にする', () => {
    expect(toMatchingKey('  First.Last+Tag@Mail.EXAMPLE \n')).toBe(
      'first.last+tag@mail.example',
    );
  });

  test('大文字小文字だけが異なるアドレスは同じ照合キーになる', () => {
    expect(toMatchingKey('USER@MAIL.EXAMPLE')).toBe(
      toMatchingKey('user@mail.example'),
    );
  });

  test('照合キーをもう一度変換しても変わらない', () => {
    const key = toMatchingKey(' User@Mail.Example ');

    expect(toMatchingKey(key)).toBe(key);
  });
});
