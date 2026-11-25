import { describe, expect, test } from 'bun:test';

import { AUDIT_REASON_MAX } from '../admin/admin-input-rules.ts';
import {
  ADMIN_LIST_PAGE_SIZE,
  checkModerationReason,
  MODERATION_ACTION_DEFINITIONS,
  MODERATION_ACTIONS,
  MODERATION_NOTICE_STATUSES,
  MODERATION_PRODUCT_LIFECYCLE_EVENTS,
  MODERATION_REASON_MAX,
  MODERATION_REASON_MESSAGES,
  MODERATION_TARGET_KINDS,
  MODERATION_USER_LIFECYCLE_EVENTS,
  type ModerationAction,
  NOTICE_EXCERPT_MAX,
  STATISTICS_WEEKS_SHOWN,
} from './moderation-actions.ts';

const FAMILY_EMOJI = '👨‍👩‍👧‍👦';

const COMBINED_KANA = '\u304b\u3099';

const VARIATION_HEART = '\u2764\ufe0f';

const surround = (value: string): string => ` \u3000\t${value}\r\n\u3000 `;

const REQUIRED_REASON_ACTIONS: readonly ModerationAction[] = [
  'user.suspend',
  'user.unsuspend',
  'user.administrative-withdraw',
  'product.hide',
  'product.unhide',
  'comment.hide',
  'comment.unhide',
  'rating.invalidate',
  'rating.revalidate',
];

const OPTIONAL_REASON_ACTIONS: readonly ModerationAction[] = [
  'image.approve',
  'image.quarantine',
  'image.release',
  'image.delete',
];

const WHITE_SPACE_ONLY_VALUES = [
  ['空文字列', ''],
  ['半角スペースだけ', '   '],
  ['全角空白・タブ・改行だけ', '\u3000\t\r\n\u3000'],
] as const;

const WITHIN_LIMIT_VALUES = [
  ['半角英字', 'a'.repeat(500)],
  ['ZWJで結合した絵文字', FAMILY_EMOJI.repeat(500)],
  ['結合文字の濁点', COMBINED_KANA.repeat(500)],
  ['異体字セレクタ付きの絵文字', VARIATION_HEART.repeat(500)],
  ['前後の空白を除いた半角英字', surround('a'.repeat(500))],
] as const;

const OVER_LIMIT_VALUES = [
  ['半角英字', 'a'.repeat(501)],
  ['ZWJで結合した絵文字', FAMILY_EMOJI.repeat(501)],
  ['結合文字の濁点', COMBINED_KANA.repeat(501)],
  ['異体字セレクタ付きの絵文字', VARIATION_HEART.repeat(501)],
  ['前後の空白を除いた半角英字', surround('a'.repeat(501))],
] as const;

describe('措置の種類と対象の種類', () => {
  test('13種の措置の種類を定める', () => {
    expect(MODERATION_ACTIONS).toEqual([
      'user.suspend',
      'user.unsuspend',
      'user.administrative-withdraw',
      'product.hide',
      'product.unhide',
      'comment.hide',
      'comment.unhide',
      'rating.invalidate',
      'rating.revalidate',
      'image.approve',
      'image.quarantine',
      'image.release',
      'image.delete',
    ]);
  });

  test('措置の対象の種類は利用者・プロダクト・コメント・評価・画像の5つである', () => {
    expect(MODERATION_TARGET_KINDS).toEqual([
      'user',
      'product',
      'comment',
      'rating',
      'image',
    ]);
  });

  test('通知の状態は送らない・依頼待ち・依頼済み・送らなかったの4つである', () => {
    expect(MODERATION_NOTICE_STATUSES).toEqual([
      'none',
      'pending',
      'requested',
      'skipped',
    ]);
  });

  test('全ての措置の種類に定義があり、定義の種類の名前が鍵と一致する', () => {
    expect(Object.keys(MODERATION_ACTION_DEFINITIONS).toSorted()).toEqual(
      [...MODERATION_ACTIONS].toSorted(),
    );
    for (const action of MODERATION_ACTIONS) {
      expect(MODERATION_ACTION_DEFINITIONS[action].action).toBe(action);
    }
  });

  test('各措置の対象の種類は種類の名前の接頭辞と一致する', () => {
    expect(
      Object.fromEntries(
        MODERATION_ACTIONS.map((action) => [
          action,
          MODERATION_ACTION_DEFINITIONS[action].targetKind,
        ]),
      ),
    ).toEqual({
      'user.suspend': 'user',
      'user.unsuspend': 'user',
      'user.administrative-withdraw': 'user',
      'product.hide': 'product',
      'product.unhide': 'product',
      'comment.hide': 'comment',
      'comment.unhide': 'comment',
      'rating.invalidate': 'rating',
      'rating.revalidate': 'rating',
      'image.approve': 'image',
      'image.quarantine': 'image',
      'image.release': 'image',
      'image.delete': 'image',
    });
  });

  test('定義の一覧と各定義は書き換えられない', () => {
    expect(Object.isFrozen(MODERATION_ACTIONS)).toBe(true);
    expect(Object.isFrozen(MODERATION_ACTION_DEFINITIONS)).toBe(true);
    for (const action of MODERATION_ACTIONS) {
      expect(Object.isFrozen(MODERATION_ACTION_DEFINITIONS[action])).toBe(true);
    }
  });
});

describe('理由の要否', () => {
  test.each(REQUIRED_REASON_ACTIONS)('%sは理由が必須である', (action) => {
    expect(MODERATION_ACTION_DEFINITIONS[action].reason).toBe('required');
  });

  test.each(OPTIONAL_REASON_ACTIONS)('%sは理由が任意である', (action) => {
    expect(MODERATION_ACTION_DEFINITIONS[action].reason).toBe('optional');
  });
});

describe('通知の要否', () => {
  test('停止・非公開化・コメントの非公開化だけ依頼待ちで送り、代理の退会を含む他は送らない', () => {
    expect(
      Object.fromEntries(
        MODERATION_ACTIONS.map((action) => [
          action,
          MODERATION_ACTION_DEFINITIONS[action].notice,
        ]),
      ),
    ).toEqual({
      'user.suspend': 'deferred',
      'user.unsuspend': 'none',
      'user.administrative-withdraw': 'none',
      'product.hide': 'deferred',
      'product.unhide': 'none',
      'comment.hide': 'deferred',
      'comment.unhide': 'none',
      'rating.invalidate': 'none',
      'rating.revalidate': 'none',
      'image.approve': 'none',
      'image.quarantine': 'none',
      'image.release': 'none',
      'image.delete': 'none',
    });
  });
});

describe('対応するライフサイクルの種類', () => {
  test('利用者とプロダクトの措置だけがライフサイクルのイベントの種類を持つ', () => {
    expect(
      Object.fromEntries(
        MODERATION_ACTIONS.map((action) => [
          action,
          MODERATION_ACTION_DEFINITIONS[action].lifecycleEvent,
        ]),
      ),
    ).toEqual({
      'user.suspend': 'suspended',
      'user.unsuspend': 'unsuspended',
      'user.administrative-withdraw': 'withdrawn',
      'product.hide': 'hidden',
      'product.unhide': 'unhidden',
      'comment.hide': null,
      'comment.unhide': null,
      'rating.invalidate': null,
      'rating.revalidate': null,
      'image.approve': null,
      'image.quarantine': null,
      'image.release': null,
      'image.delete': null,
    });
  });

  test('利用者の措置のイベントの種類は利用者のライフサイクルの写しに、プロダクトの措置のものはプロダクトの写しに含まれる', () => {
    expect(MODERATION_USER_LIFECYCLE_EVENTS).toEqual([
      'suspended',
      'unsuspended',
      'withdrawn',
    ]);
    expect(MODERATION_PRODUCT_LIFECYCLE_EVENTS).toEqual(['hidden', 'unhidden']);
    for (const action of MODERATION_ACTIONS) {
      const { targetKind, lifecycleEvent } =
        MODERATION_ACTION_DEFINITIONS[action];
      if (targetKind === 'user') {
        expect(MODERATION_USER_LIFECYCLE_EVENTS).toContain(
          lifecycleEvent as never,
        );
      }
      if (targetKind === 'product') {
        expect(MODERATION_PRODUCT_LIFECYCLE_EVENTS).toContain(
          lifecycleEvent as never,
        );
      }
    }
  });
});

describe('件数の定数', () => {
  test('要件と設計の値と一致し、理由の上限は監査ログの理由の上限と同じである', () => {
    expect({
      MODERATION_REASON_MAX,
      NOTICE_EXCERPT_MAX,
      ADMIN_LIST_PAGE_SIZE,
      STATISTICS_WEEKS_SHOWN,
    }).toEqual({
      MODERATION_REASON_MAX: 500,
      NOTICE_EXCERPT_MAX: 100,
      ADMIN_LIST_PAGE_SIZE: 50,
      STATISTICS_WEEKS_SHOWN: 26,
    });
    expect(MODERATION_REASON_MAX).toBe(AUDIT_REASON_MAX);
  });
});

describe('checkModerationReason', () => {
  describe.each(REQUIRED_REASON_ACTIONS)('理由が必須の%s', (action) => {
    test('理由の省略を未入力として拒む', () => {
      expect(checkModerationReason(action, undefined)).toBe('required');
    });

    test.each(WHITE_SPACE_ONLY_VALUES)('%sを未入力として拒む', (_, value) => {
      expect(checkModerationReason(action, value)).toBe('required');
    });

    test('空白だけの入力は上限を超える長さでも未入力として拒む', () => {
      expect(checkModerationReason(action, ' '.repeat(501))).toBe('required');
    });

    test.each(WITHIN_LIMIT_VALUES)('%sの500書記素を受け付ける', (_, value) => {
      expect(checkModerationReason(action, value)).toBe('ok');
    });

    test.each(OVER_LIMIT_VALUES)('%sの501書記素を拒む', (_, value) => {
      expect(checkModerationReason(action, value)).toBe('too-long');
    });
  });

  describe.each(OPTIONAL_REASON_ACTIONS)('理由が任意の%s', (action) => {
    test('理由の省略を受け付ける', () => {
      expect(checkModerationReason(action, undefined)).toBe('ok');
    });

    test.each(WHITE_SPACE_ONLY_VALUES)('%sを受け付ける', (_, value) => {
      expect(checkModerationReason(action, value)).toBe('ok');
    });

    test.each(WITHIN_LIMIT_VALUES)('%sの500書記素を受け付ける', (_, value) => {
      expect(checkModerationReason(action, value)).toBe('ok');
    });

    test.each(OVER_LIMIT_VALUES)('%sの501書記素を拒む', (_, value) => {
      expect(checkModerationReason(action, value)).toBe('too-long');
    });
  });
});

describe('MODERATION_REASON_MESSAGES', () => {
  test('違反の種類ごとに文言規則の文言を持ち、違反の無い結果には文言を持たない', () => {
    expect(MODERATION_REASON_MESSAGES).toEqual({
      ok: undefined,
      required: '理由を入力してください。',
      'too-long': '理由は500文字以内で入力してください。',
    });
    expect(Object.isFrozen(MODERATION_REASON_MESSAGES)).toBe(true);
  });
});
