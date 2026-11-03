import { describe, expect, expectTypeOf, test } from 'bun:test';

import { AUDIT_REASON_MAX } from '../../../common-lib/admin/admin-input-rules.ts';
import {
  type AuditActionDefinition,
  createAuditActionCatalog,
  defineAuditAction,
} from '../../../common-lib/admin/audit-action.ts';
import { AUDIT_ACTIONS } from '../../../common-lib/admin/audit-actions/index.ts';
import {
  type AuditEntryInput,
  type AuditEntryViolation,
  validateAuditEntry,
} from './audit-entry.ts';

const FAMILY_EMOJI = '👨‍👩‍👧‍👦';

const OPERATOR_ADMIN_ID = '01JBX8Y4Z5ABCDEFGHJKMNPQRS';

const TARGET_ADMIN_ID = '01JBX8Y4Z5ABCDEFGHJKMNPQRT';

const USER_PSEUDONYMOUS_ID = '0b5f8c3e-2d4a-4f6b-9c1e-7a8d9e0f1a2b';

const OCCURRED_AT = new Date('2026-11-03T12:00:00.000Z');

const REASON_REQUIRED_ACTION = defineAuditAction({
  name: 'product.suspend',
  label: '製品の公開停止',
  targetKind: 'product',
  reason: 'required',
  detailKeys: [],
  maxTargets: 1,
});

const TARGETLESS_ACTION = defineAuditAction({
  name: 'setting.export',
  label: '設定の書き出し',
  targetKind: null,
  reason: 'optional',
  detailKeys: [],
  maxTargets: 1,
});

const CATALOG = createAuditActionCatalog([
  ...AUDIT_ACTIONS,
  REASON_REQUIRED_ACTION,
  TARGETLESS_ACTION,
]);

const entry = (
  action: AuditActionDefinition,
  overrides: Partial<AuditEntryInput> = {},
): AuditEntryInput => ({
  operatorAdminId: OPERATOR_ADMIN_ID,
  action: action.name,
  targetIds: action.targetKind === null ? [] : [TARGET_ADMIN_ID],
  occurredAt: OCCURRED_AT,
  ...overrides,
});

const inviteEntry = (overrides: Partial<AuditEntryInput> = {}) =>
  entry(
    CATALOG.find('admin-account.invite') as AuditActionDefinition,
    overrides,
  );

const roleChangeEntry = (overrides: Partial<AuditEntryInput> = {}) =>
  entry(CATALOG.find('admin-account.role-change') as AuditActionDefinition, {
    detail: { fromRole: 'viewer', toRole: 'moderator' },
    ...overrides,
  });

const emailSearchEntry = (targetIds: readonly string[]) =>
  entry(CATALOG.find('user.email-search') as AuditActionDefinition, {
    targetIds,
  });

const reasonRequiredEntry = (overrides: Partial<AuditEntryInput> = {}) =>
  entry(REASON_REQUIRED_ACTION, { targetIds: ['product-1'], ...overrides });

const uuids = (count: number): string[] =>
  Array.from(
    { length: count },
    (_, index) =>
      `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`,
  );

const violationOf = (input: AuditEntryInput): AuditEntryViolation | 'ok' => {
  const result = validateAuditEntry(input, CATALOG);
  return result.ok ? 'ok' : result.violation;
};

const reasonOf = (input: AuditEntryInput): string | null => {
  const result = validateAuditEntry(input, CATALOG);
  if (!result.ok) {
    throw new Error(`検証に失敗しました: ${result.violation}`);
  }
  return result.reason;
};

describe('validateAuditEntry', () => {
  test('違反の種類は8つである', () => {
    expectTypeOf<AuditEntryViolation>().toEqualTypeOf<
      | 'unknown_action'
      | 'reason_required'
      | 'reason_not_allowed'
      | 'reason_too_long'
      | 'invalid_target'
      | 'too_many_targets'
      | 'targets_not_allowed'
      | 'invalid_detail'
    >();
  });

  describe('操作種別', () => {
    test('登録された操作種別の妥当な入力を受け付ける', () => {
      expect(validateAuditEntry(inviteEntry(), CATALOG)).toEqual({
        ok: true,
        reason: null,
      });
    });

    test('登録されていない操作種別を拒否する', () => {
      expect(
        violationOf(inviteEntry({ action: 'admin-account.unknown' })),
      ).toBe('unknown_action');
    });

    test('登録されていない操作種別は他の違反より先に示す', () => {
      expect(
        violationOf(
          inviteEntry({
            action: 'admin-account.unknown',
            targetIds: ['不正な識別子'],
            reason: 'x'.repeat(AUDIT_REASON_MAX + 1),
          }),
        ),
      ).toBe('unknown_action');
    });
  });

  describe('理由', () => {
    test('理由が必須の操作種別で理由が無ければ拒否する', () => {
      expect(violationOf(reasonRequiredEntry())).toBe('reason_required');
    });

    test.each([
      ['空文字列', ''],
      ['半角スペースだけ', '   '],
      ['全角空白・タブ・改行だけ', '\u3000\t\r\n\u3000'],
    ])('理由が必須の操作種別で理由が%sなら拒否する', (_, reason) => {
      expect(violationOf(reasonRequiredEntry({ reason }))).toBe(
        'reason_required',
      );
    });

    test('理由が必須の操作種別では前後の空白を除いた理由を返す', () => {
      expect(
        reasonOf(reasonRequiredEntry({ reason: '\u3000 規約違反 \n' })),
      ).toBe('規約違反');
    });

    test.each([
      ['無い', undefined],
      ['空文字列', ''],
      ['空白だけ', ' \u3000\t\n'],
    ])(
      '理由が任意の操作種別で理由が%s場合は未入力として受け付ける',
      (_, reason) => {
        expect(
          reasonOf(inviteEntry(reason === undefined ? {} : { reason })),
        ).toBeNull();
      },
    );

    test('理由が任意の操作種別では前後の空白を除いた理由を返す', () => {
      expect(reasonOf(inviteEntry({ reason: '  採用のため\t' }))).toBe(
        '採用のため',
      );
    });

    test('理由が不要の操作種別で理由に値があれば拒否する', () => {
      expect(
        violationOf({
          ...emailSearchEntry([USER_PSEUDONYMOUS_ID]),
          reason: '調査',
        }),
      ).toBe('reason_not_allowed');
    });

    test('理由が不要の操作種別で理由が上限を超えていても値があることを示す', () => {
      expect(
        violationOf({
          ...emailSearchEntry([USER_PSEUDONYMOUS_ID]),
          reason: 'x'.repeat(AUDIT_REASON_MAX + 1),
        }),
      ).toBe('reason_not_allowed');
    });

    test('理由が不要の操作種別で理由が空白だけなら未入力として受け付ける', () => {
      expect(
        reasonOf({
          ...emailSearchEntry([USER_PSEUDONYMOUS_ID]),
          reason: ' \u3000',
        }),
      ).toBeNull();
    });

    test('前後の空白を除いて500書記素の理由を受け付ける', () => {
      const reason = FAMILY_EMOJI.repeat(AUDIT_REASON_MAX);
      expect(reasonOf(inviteEntry({ reason: ` ${reason}\u3000` }))).toBe(
        reason,
      );
    });

    test('501書記素の理由を拒否する', () => {
      expect(
        violationOf(
          inviteEntry({ reason: FAMILY_EMOJI.repeat(AUDIT_REASON_MAX + 1) }),
        ),
      ).toBe('reason_too_long');
    });

    test('理由が必須の操作種別でも501書記素の理由を拒否する', () => {
      expect(
        violationOf(
          reasonRequiredEntry({ reason: 'あ'.repeat(AUDIT_REASON_MAX + 1) }),
        ),
      ).toBe('reason_too_long');
    });
  });

  describe('対象', () => {
    test('ユーザーが対象の操作種別で仮名化IDを受け付ける', () => {
      expect(violationOf(emailSearchEntry([USER_PSEUDONYMOUS_ID]))).toBe('ok');
      expect(
        violationOf(emailSearchEntry([USER_PSEUDONYMOUS_ID.toUpperCase()])),
      ).toBe('ok');
    });

    test.each([
      ['空文字列', ''],
      ['ULIDの形', TARGET_ADMIN_ID],
      ['メールアドレス', 'someone@launch-stadium.example'],
      ['区切りの無いUUID', USER_PSEUDONYMOUS_ID.replaceAll('-', '')],
      ['前後に空白のあるUUID', ` ${USER_PSEUDONYMOUS_ID} `],
      ['16進数以外を含むUUID', 'gb5f8c3e-2d4a-4f6b-9c1e-7a8d9e0f1a2b'],
    ])('ユーザーが対象の操作種別で%sを拒否する', (_, targetId) => {
      expect(
        violationOf(emailSearchEntry([USER_PSEUDONYMOUS_ID, targetId])),
      ).toBe('invalid_target');
    });

    test('ユーザーのメールアドレス検索は対象0件を受け付ける', () => {
      expect(violationOf(emailSearchEntry([]))).toBe('ok');
    });

    test('ユーザーのメールアドレス検索は対象100件まで受け付ける', () => {
      expect(violationOf(emailSearchEntry(uuids(100)))).toBe('ok');
    });

    test('対象の数が操作種別の上限を超えれば拒否する', () => {
      expect(violationOf(emailSearchEntry(uuids(101)))).toBe(
        'too_many_targets',
      );
      expect(
        violationOf(
          inviteEntry({ targetIds: [TARGET_ADMIN_ID, OPERATOR_ADMIN_ID] }),
        ),
      ).toBe('too_many_targets');
    });

    test('ユーザー以外の対象は64文字までの英数字と記号._:-を受け付ける', () => {
      expect(violationOf(inviteEntry({ targetIds: ['a'.repeat(64)] }))).toBe(
        'ok',
      );
      expect(
        violationOf(
          reasonRequiredEntry({ reason: '規約違反', targetIds: ['Ab0._:-'] }),
        ),
      ).toBe('ok');
    });

    test.each([
      ['空文字列', ''],
      ['65文字', 'a'.repeat(65)],
      ['空白を含む値', 'admin 1'],
      ['スラッシュを含む値', 'admin/1'],
      ['英数字以外の文字を含む値', '管理者'],
    ])('ユーザー以外の対象で%sを拒否する', (_, targetId) => {
      expect(violationOf(inviteEntry({ targetIds: [targetId] }))).toBe(
        'invalid_target',
      );
    });

    test('対象を取らない操作種別で対象が無ければ受け付ける', () => {
      expect(violationOf(entry(TARGETLESS_ACTION))).toBe('ok');
    });

    test('対象を取らない操作種別に対象を渡せば拒否する', () => {
      expect(
        violationOf(entry(TARGETLESS_ACTION, { targetIds: ['setting-1'] })),
      ).toBe('targets_not_allowed');
    });

    test('対象の違反は理由の違反の後に示す', () => {
      expect(
        violationOf(reasonRequiredEntry({ targetIds: ['不正な識別子'] })),
      ).toBe('reason_required');
    });
  });

  describe('詳細', () => {
    test('操作種別に登録された鍵の詳細を受け付ける', () => {
      expect(violationOf(roleChangeEntry())).toBe('ok');
      expect(
        violationOf(roleChangeEntry({ detail: { toRole: 'viewer' } })),
      ).toBe('ok');
    });

    test('登録されていない鍵の詳細を拒否する', () => {
      expect(
        violationOf(
          roleChangeEntry({
            detail: { fromRole: 'viewer', toRole: 'moderator', email: 'x' },
          }),
        ),
      ).toBe('invalid_detail');
    });

    test('詳細の鍵を持たない操作種別に詳細を渡せば拒否する', () => {
      expect(violationOf(inviteEntry({ detail: { toString: 'x' } }))).toBe(
        'invalid_detail',
      );
    });

    test('詳細の値は100文字まで受け付け、101文字を拒否する', () => {
      expect(
        violationOf(
          roleChangeEntry({ detail: { fromRole: 'あ'.repeat(100) } }),
        ),
      ).toBe('ok');
      expect(
        violationOf(
          roleChangeEntry({ detail: { fromRole: 'あ'.repeat(101) } }),
        ),
      ).toBe('invalid_detail');
    });

    test('文字列でない詳細の値を拒否する', () => {
      const detail = { fromRole: 1 } as unknown as Readonly<
        Record<string, string>
      >;
      expect(violationOf(roleChangeEntry({ detail }))).toBe('invalid_detail');
    });

    test('詳細の違反は対象の違反の後に示す', () => {
      expect(
        violationOf(
          roleChangeEntry({ targetIds: ['admin/1'], detail: { email: 'x' } }),
        ),
      ).toBe('invalid_target');
    });
  });
});
