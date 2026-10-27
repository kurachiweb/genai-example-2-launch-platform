import { describe, expect, test } from 'bun:test';

import { z } from 'zod';

import {
  type AnyEmailKind,
  createEmailKindRegistry,
  defineEmailKind,
  type EmailCategory,
  EmailKindRegistryError,
} from './email-kind.ts';

const welcomeInput = z.object({ displayName: z.string().min(1) });

function kindNamed(
  name: string,
  category: EmailCategory = 'transactional',
): AnyEmailKind {
  return defineEmailKind({ name, category, inputSchema: welcomeInput });
}

describe('defineEmailKind', () => {
  test('名前・分類・入力の検証規則を組にした凍結済みの種別を返す', () => {
    const kind = defineEmailKind({
      name: 'identity.welcome',
      category: 'transactional',
      inputSchema: welcomeInput,
    });

    expect(kind).toEqual({
      name: 'identity.welcome',
      category: 'transactional',
      inputSchema: welcomeInput,
    });
    expect(Object.isFrozen(kind)).toBe(true);
  });

  test('種別の検証規則でテンプレート入力を検証できる', () => {
    const kind = kindNamed('identity.welcome');

    expect(kind.inputSchema.safeParse({ displayName: '山田' }).success).toBe(
      true,
    );
    expect(kind.inputSchema.safeParse({ displayName: '' }).success).toBe(false);
  });
});

describe('createEmailKindRegistry', () => {
  test('登録した種別を名前で引け、未登録の名前はundefinedになる', () => {
    const welcome = kindNamed('identity.welcome');
    const digest = kindNamed('product.weekly-digest', 'notification');

    const registry = createEmailKindRegistry([welcome, digest]);

    expect(registry.get('identity.welcome')).toBe(welcome);
    expect(registry.get('product.weekly-digest')).toBe(digest);
    expect(registry.get('identity.goodbye')).toBeUndefined();
  });

  test.each(['toString', 'constructor', '__proto__', 'hasOwnProperty'])(
    'Objectの組み込みのプロパティ名%pは未登録として扱う',
    (name) => {
      const registry = createEmailKindRegistry([kindNamed('identity.welcome')]);

      expect(registry.get(name)).toBeUndefined();
    },
  );

  test('名前の一覧を登録順の凍結済みの配列で返す', () => {
    const registry = createEmailKindRegistry([
      kindNamed('product.weekly-digest', 'notification'),
      kindNamed('identity.welcome'),
    ]);

    expect(registry.names()).toEqual([
      'product.weekly-digest',
      'identity.welcome',
    ]);
    expect(Object.isFrozen(registry.names())).toBe(true);
  });

  test('空の登録も受け付ける', () => {
    const registry = createEmailKindRegistry([]);

    expect(registry.names()).toEqual([]);
    expect(registry.get('identity.welcome')).toBeUndefined();
  });

  test('登録に使った配列を後から変えても集約は変わらない', () => {
    const kinds = [kindNamed('identity.welcome')];
    const registry = createEmailKindRegistry(kinds);

    kinds.push(kindNamed('identity.goodbye'));

    expect(registry.names()).toEqual(['identity.welcome']);
    expect(registry.get('identity.goodbye')).toBeUndefined();
  });

  test.each([
    'email-delivery.smoke',
    'identity.welcome',
    'product.weekly-digest',
    'billing2.invoice-v2',
  ])('<ドメイン>.<名詞句>の名前%pを受け付ける', (name) => {
    expect(createEmailKindRegistry([kindNamed(name)]).names()).toEqual([name]);
  });

  test.each([
    '',
    'identity',
    'identity.',
    '.welcome',
    'Identity.welcome',
    'identity.Welcome',
    'identity.weeklyDigest',
    'identity_welcome',
    'identity.weekly_digest',
    'identity.weekly.digest',
    'identity.-welcome',
    'identity.welcome-',
    'identity..welcome',
    '1identity.welcome',
    ' identity.welcome',
    'identity.welcome ',
  ])(
    '<ドメイン>.<名詞句>の形でない名前%pはEmailKindRegistryErrorになる',
    (name) => {
      expect(() => createEmailKindRegistry([kindNamed(name)])).toThrow(
        EmailKindRegistryError,
      );
    },
  );

  test('名前の重複はEmailKindRegistryErrorになり、文言に重複した名前を含む', () => {
    const register = (): unknown =>
      createEmailKindRegistry([
        kindNamed('identity.welcome'),
        kindNamed('product.weekly-digest', 'notification'),
        kindNamed('identity.welcome', 'notification'),
      ]);

    expect(register).toThrow(EmailKindRegistryError);
    expect(register).toThrow('"identity.welcome"');
  });

  test('分類がトランザクションと通知のどちらでもない登録はEmailKindRegistryErrorになる', () => {
    const kind = {
      name: 'identity.welcome',
      category: 'marketing',
      inputSchema: welcomeInput,
    } as unknown as AnyEmailKind;

    expect(() => createEmailKindRegistry([kind])).toThrow(
      EmailKindRegistryError,
    );
  });

  test.each([undefined, null, {}, { safeParse: 'not-a-function' }])(
    '入力の検証規則%pが欠けた登録はEmailKindRegistryErrorになる',
    (inputSchema) => {
      const kind = {
        name: 'identity.welcome',
        category: 'transactional',
        inputSchema,
      } as unknown as AnyEmailKind;

      expect(() => createEmailKindRegistry([kind])).toThrow(
        EmailKindRegistryError,
      );
    },
  );

  test('EmailKindRegistryErrorはErrorを継承し、名前で区別できる', () => {
    const error = new EmailKindRegistryError('メール種別の登録が不正です');

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('EmailKindRegistryError');
  });

  test('集約の結果は凍結されている', () => {
    expect(Object.isFrozen(createEmailKindRegistry([]))).toBe(true);
  });
});
