import { describe, expect, test } from 'bun:test';

import {
  type AuditActionDefinition,
  AuditActionDefinitionError,
  createAuditActionCatalog,
  defineAuditAction,
} from './audit-action.ts';

const baseDefinition: AuditActionDefinition = {
  name: 'admin-account.invite',
  label: '管理者の招待',
  targetKind: 'admin',
  reason: 'optional',
  detailKeys: [],
  maxTargets: 1,
};

const definitionWith = (
  overrides: Partial<AuditActionDefinition>,
): AuditActionDefinition => ({ ...baseDefinition, ...overrides });

const actionNamed = (name: string): AuditActionDefinition =>
  defineAuditAction(definitionWith({ name }));

describe('defineAuditAction', () => {
  test('名前・表示名・対象の種類・理由の要否・詳細の鍵・対象の上限を組にした凍結済みの定義を返す', () => {
    const action = defineAuditAction(
      definitionWith({
        name: 'admin-account.role-change',
        label: '管理者のロールの変更',
        detailKeys: ['fromRole', 'toRole'],
      }),
    );

    expect(action).toEqual({
      name: 'admin-account.role-change',
      label: '管理者のロールの変更',
      targetKind: 'admin',
      reason: 'optional',
      detailKeys: ['fromRole', 'toRole'],
      maxTargets: 1,
    });
    expect(Object.isFrozen(action)).toBe(true);
    expect(Object.isFrozen(action.detailKeys)).toBe(true);
  });

  test('渡した詳細の鍵の配列を後から変えても定義は変わらない', () => {
    const detailKeys = ['fromRole'];

    const action = defineAuditAction(definitionWith({ detailKeys }));
    detailKeys.push('email');

    expect(action.detailKeys).toEqual(['fromRole']);
  });

  test('対象を取らない操作種別は対象の種類をnullにできる', () => {
    const action = defineAuditAction(
      definitionWith({ name: 'setting.update', targetKind: null }),
    );

    expect(action.targetKind).toBeNull();
  });

  test.each(['required', 'optional', 'none'] as const)(
    '理由の要否%pを受け付ける',
    (reason) => {
      expect(defineAuditAction(definitionWith({ reason })).reason).toBe(reason);
    },
  );

  test.each([
    'user.email-search',
    'admin-account.role-change',
    'help-article.publish',
    'product2.hide',
  ])('名前%pは<対象の領域>.<動詞句>の形として受け付ける', (name) => {
    expect(actionNamed(name).name).toBe(name);
  });

  test.each([
    '',
    'invite',
    'admin-account.',
    '.invite',
    'Admin-account.invite',
    'admin-account.Invite',
    'admin_account.invite',
    'admin-account.role_change',
    'admin-account.invite.again',
    '1admin.invite',
    'admin.1invite',
    'admin account.invite',
    ' admin-account.invite',
    'admin-account.invite\n',
  ])('名前%pは形式違反として例外にする', (name) => {
    expect(() => actionNamed(name)).toThrow(AuditActionDefinitionError);
  });

  test.each(['', '   ', '　'])('表示名%pは空として例外にする', (label) => {
    expect(() => defineAuditAction(definitionWith({ label }))).toThrow(
      AuditActionDefinitionError,
    );
  });

  test('登録外の対象の種類は例外にする', () => {
    const definition = {
      ...baseDefinition,
      targetKind: 'email',
    } as unknown as AuditActionDefinition;

    expect(() => defineAuditAction(definition)).toThrow(
      AuditActionDefinitionError,
    );
  });

  test('法務文書は監査ログに記録しないため、対象の種類legal-documentを登録外として例外にする', () => {
    const definition = {
      ...baseDefinition,
      targetKind: 'legal-document',
    } as unknown as AuditActionDefinition;

    expect(() => defineAuditAction(definition)).toThrow(
      '対象の種類が登録されていません: "legal-document"',
    );
  });

  test('登録外の理由の要否は例外にする', () => {
    const definition = {
      ...baseDefinition,
      reason: 'sometimes',
    } as unknown as AuditActionDefinition;

    expect(() => defineAuditAction(definition)).toThrow(
      AuditActionDefinitionError,
    );
  });

  test.each([
    [['fromRole', 'fromRole']],
    [['']],
    [['FromRole']],
    [['from-role']],
    [['from_role']],
    [['1role']],
  ])('詳細の鍵%pは形式違反か重複として例外にする', (detailKeys) => {
    expect(() => defineAuditAction(definitionWith({ detailKeys }))).toThrow(
      AuditActionDefinitionError,
    );
  });

  test.each([1, 100])('対象の上限%pを受け付ける', (maxTargets) => {
    expect(defineAuditAction(definitionWith({ maxTargets })).maxTargets).toBe(
      maxTargets,
    );
  });

  test.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    '対象の上限%pは1以上の整数でないため例外にする',
    (maxTargets) => {
      expect(() => defineAuditAction(definitionWith({ maxTargets }))).toThrow(
        AuditActionDefinitionError,
      );
    },
  );

  test('例外の文言に違反した操作種別の名前を含める', () => {
    expect(() =>
      defineAuditAction(
        definitionWith({ name: 'admin-account.invite', maxTargets: 0 }),
      ),
    ).toThrow('"admin-account.invite"');
  });
});

describe('createAuditActionCatalog', () => {
  test('登録した操作種別を名前で引け、未登録の名前はundefinedになる', () => {
    const invite = actionNamed('admin-account.invite');
    const search = actionNamed('user.email-search');

    const catalog = createAuditActionCatalog([invite, search]);

    expect(catalog.find('admin-account.invite')).toBe(invite);
    expect(catalog.find('user.email-search')).toBe(search);
    expect(catalog.find('admin-account.restore')).toBeUndefined();
  });

  test.each(['toString', 'constructor', '__proto__', 'hasOwnProperty'])(
    'Objectの組み込みのプロパティ名%pは未登録として扱う',
    (name) => {
      const catalog = createAuditActionCatalog([
        actionNamed('admin-account.invite'),
      ]);

      expect(catalog.find(name)).toBeUndefined();
    },
  );

  test('一覧を登録順の凍結済みの配列で返す', () => {
    const search = actionNamed('user.email-search');
    const invite = actionNamed('admin-account.invite');

    const catalog = createAuditActionCatalog([search, invite]);

    expect(catalog.list()).toEqual([search, invite]);
    expect(Object.isFrozen(catalog.list())).toBe(true);
  });

  test('渡した配列を後から変えてもカタログは変わらない', () => {
    const actions = [actionNamed('admin-account.invite')];

    const catalog = createAuditActionCatalog(actions);
    actions.push(actionNamed('user.email-search'));

    expect(catalog.list()).toHaveLength(1);
    expect(catalog.find('user.email-search')).toBeUndefined();
  });

  test('名前の重複は例外にする', () => {
    expect(() =>
      createAuditActionCatalog([
        actionNamed('admin-account.invite'),
        defineAuditAction(
          definitionWith({ name: 'admin-account.invite', label: '別の表示名' }),
        ),
      ]),
    ).toThrow(AuditActionDefinitionError);
  });

  test('defineAuditActionを経ずに組み立てた形式違反の定義も例外にする', () => {
    expect(() =>
      createAuditActionCatalog([definitionWith({ name: 'invite' })]),
    ).toThrow(AuditActionDefinitionError);
  });

  test('空の一覧から作ったカタログは何も引けない', () => {
    const catalog = createAuditActionCatalog([]);

    expect(catalog.list()).toEqual([]);
    expect(catalog.find('admin-account.invite')).toBeUndefined();
  });

  test('カタログ自体は凍結されていて差し替えられない', () => {
    expect(Object.isFrozen(createAuditActionCatalog([]))).toBe(true);
  });
});
