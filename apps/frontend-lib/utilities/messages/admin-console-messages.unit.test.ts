import { describe, expect, test } from 'bun:test';

import {
  ADMIN_NICKNAME_MAX,
  ADMIN_TITLE_MAX,
  AUDIT_REASON_MAX,
  CATEGORY_NAME_MAX,
  checkAdminNickname,
  checkAdminTitle,
  checkAuditReason,
  checkCategoryName,
} from '../../../common-lib/admin/admin-input-rules.ts';
import {
  ADMIN_FILTER_LABEL,
  ADMIN_PAGINATION_LABEL,
  APPLY_FILTER_LABEL,
  AUDITED_ACTION_NOTICE,
  CATEGORY_ACTIONS_LABEL,
  CATEGORY_CREATE_LABEL,
  CATEGORY_CREATE_SUBMIT_LABEL,
  CATEGORY_DELETE_DESCRIPTION,
  CATEGORY_DELETE_LABEL,
  CATEGORY_EDIT_LABEL,
  CATEGORY_EMPTY_MESSAGE,
  CATEGORY_HANDLE_LABEL,
  CATEGORY_HANDLE_UNSET_LABEL,
  CATEGORY_NAME_LABEL,
  CATEGORY_NAME_REQUIRED_MESSAGE,
  CATEGORY_NAME_TOO_LONG_MESSAGE,
  CATEGORY_READ_ONLY_NOTICE,
  CATEGORY_SYSTEM_DEFAULT_LABEL,
  CATEGORY_SYSTEM_DEFAULT_NOTICE,
  CATEGORY_UPDATE_SUBMIT_LABEL,
  categoryDeleteTitle,
  categoryEditTitle,
  categoryRowActionTarget,
  CONFIRM_ACTION_CANCEL_LABEL,
  NEXT_PAGE_LABEL,
  OPTIONAL_REASON_LABEL,
  PREVIOUS_PAGE_LABEL,
  REASON_PERSONAL_INFORMATION_NOTICE,
  REASON_REQUIRED_MESSAGE,
  REASON_TOO_LONG_MESSAGE,
  REQUIRED_CATEGORY_NAME_LABEL,
  REQUIRED_REASON_LABEL,
  RESET_FILTER_LABEL,
} from './admin-console-messages.ts';

const LABELS = [
  ADMIN_PAGINATION_LABEL,
  PREVIOUS_PAGE_LABEL,
  NEXT_PAGE_LABEL,
  ADMIN_FILTER_LABEL,
  APPLY_FILTER_LABEL,
  RESET_FILTER_LABEL,
];

const SENTENCES = [
  REASON_PERSONAL_INFORMATION_NOTICE,
  REASON_REQUIRED_MESSAGE,
  REASON_TOO_LONG_MESSAGE,
  AUDITED_ACTION_NOTICE,
];

describe('管理画面の共通部品の文言', () => {
  test('ページ送りと絞り込みの名前と操作は、この部品で定めた文言のまま変わらない', () => {
    expect(LABELS).toStrictEqual([
      'ページ送り',
      '前へ',
      '次へ',
      '絞り込み',
      '適用',
      '解除',
    ]);
  });

  test('名前と操作は句点の無い体言止めにする', () => {
    for (const label of [
      ...LABELS,
      REQUIRED_REASON_LABEL,
      OPTIONAL_REASON_LABEL,
      CONFIRM_ACTION_CANCEL_LABEL,
    ]) {
      expect(label).not.toMatch(/(?:。|です|ます)$/u);
    }
  });

  test('同じ領域に並ぶ操作の名前は互いに異なる', () => {
    expect(PREVIOUS_PAGE_LABEL).not.toBe(NEXT_PAGE_LABEL);
    expect(APPLY_FILTER_LABEL).not.toBe(RESET_FILTER_LABEL);
  });

  test('理由の欄の名前は、必須か任意かを括弧で添える', () => {
    expect(REQUIRED_REASON_LABEL).toBe('理由(必須)');
    expect(OPTIONAL_REASON_LABEL).toBe('理由(任意)');
    expect(CONFIRM_ACTION_CANCEL_LABEL).toBe('キャンセル');
  });

  test('理由の検証の文言は、APIサーバーの監査ログの記録の文言と同じで、上限を入力規則の定数から示す', () => {
    expect(REASON_REQUIRED_MESSAGE).toBe('理由を入力してください。');
    expect(REASON_TOO_LONG_MESSAGE).toBe(
      `理由は${String(AUDIT_REASON_MAX)}文字以内で入力してください。`,
    );
    expect(REASON_TOO_LONG_MESSAGE).toBe(
      '理由は500文字以内で入力してください。',
    );
  });

  test('理由の注意は個人情報を含めないことを示し、監査ログの表示は記録されることを示す', () => {
    expect(REASON_PERSONAL_INFORMATION_NOTICE).toContain('個人情報');
    expect(REASON_PERSONAL_INFORMATION_NOTICE).toContain('含めないでください');
    expect(AUDITED_ACTION_NOTICE).toBe('この操作は監査ログに記録されます。');
  });

  test('文の文言は句点で終える', () => {
    for (const sentence of SENTENCES) {
      expect(sentence).toMatch(/。$/u);
    }
  });

  describe('カテゴリマスタの編集部品', () => {
    const categoryLabels = [
      CATEGORY_NAME_LABEL,
      REQUIRED_CATEGORY_NAME_LABEL,
      CATEGORY_HANDLE_LABEL,
      CATEGORY_ACTIONS_LABEL,
      CATEGORY_HANDLE_UNSET_LABEL,
      CATEGORY_SYSTEM_DEFAULT_LABEL,
      CATEGORY_CREATE_LABEL,
      CATEGORY_CREATE_SUBMIT_LABEL,
      CATEGORY_UPDATE_SUBMIT_LABEL,
      CATEGORY_EDIT_LABEL,
      CATEGORY_DELETE_LABEL,
    ];
    const categorySentences = [
      CATEGORY_EMPTY_MESSAGE,
      CATEGORY_SYSTEM_DEFAULT_NOTICE,
      CATEGORY_READ_ONLY_NOTICE,
      CATEGORY_NAME_REQUIRED_MESSAGE,
      CATEGORY_NAME_TOO_LONG_MESSAGE,
      CATEGORY_DELETE_DESCRIPTION,
    ];

    test('名前と操作は句点の無い体言止めにし、文は句点で終える', () => {
      for (const label of categoryLabels) {
        expect(label).not.toMatch(/(?:。|です|ます)$/u);
      }
      for (const sentence of categorySentences) {
        expect(sentence).toMatch(/。$/u);
      }
    });

    test('同じ行や同じダイアログに並ぶ操作の名前は互いに異なる', () => {
      expect(CATEGORY_EDIT_LABEL).not.toBe(CATEGORY_DELETE_LABEL);
      expect(CATEGORY_CREATE_SUBMIT_LABEL).not.toBe(
        CONFIRM_ACTION_CANCEL_LABEL,
      );
      expect(CATEGORY_UPDATE_SUBMIT_LABEL).not.toBe(
        CONFIRM_ACTION_CANCEL_LABEL,
      );
    });

    test('名前の入力欄の名前は、列の見出しのカテゴリ名に必須であることを括弧で添える', () => {
      expect(REQUIRED_CATEGORY_NAME_LABEL).toBe(`${CATEGORY_NAME_LABEL}(必須)`);
      expect(REQUIRED_CATEGORY_NAME_LABEL).toBe('カテゴリ名(必須)');
    });

    test('名前の検証の文言は、入力を求める文言と、上限を入力規則の定数から示す文言にする', () => {
      expect(CATEGORY_NAME_REQUIRED_MESSAGE).toBe(
        'カテゴリ名を入力してください。',
      );
      expect(CATEGORY_NAME_TOO_LONG_MESSAGE).toBe(
        `カテゴリ名は${String(CATEGORY_NAME_MAX)}文字以内で入力してください。`,
      );
      expect(CATEGORY_NAME_TOO_LONG_MESSAGE).toBe(
        'カテゴリ名は30文字以内で入力してください。',
      );
    });

    test('編集と削除の題名と行の操作の対象は、カテゴリ名を鉤括弧で囲む', () => {
      expect(categoryEditTitle('開発ツール')).toBe(
        'カテゴリ「開発ツール」を編集',
      );
      expect(categoryDeleteTitle('開発ツール')).toBe(
        'カテゴリ「開発ツール」を削除しますか?',
      );
      expect(
        `${categoryRowActionTarget('開発ツール')}${CATEGORY_EDIT_LABEL}`,
      ).toBe('「開発ツール」を編集');
    });
  });

  // 単体テストのカバレッジは読み込んだ共用部品のファイルも分母に数えるため、文言が上限を示す入力規則の判定を全て上限の前後で呼ぶ
  describe('文言が示す上限と共用部品の入力規則の判定', () => {
    test.each([
      { name: 'カテゴリ名', check: checkCategoryName, max: CATEGORY_NAME_MAX },
      {
        name: 'ニックネーム',
        check: checkAdminNickname,
        max: ADMIN_NICKNAME_MAX,
      },
    ])(
      '必須の$nameは空白だけを拒み、上限の文字数までを受け付ける',
      ({ check, max }) => {
        expect(check(' \u3000')).toBe('empty');
        expect(check('あ'.repeat(max))).toBeUndefined();
        expect(check('あ'.repeat(max + 1))).toBe('too-long');
      },
    );

    test.each([
      { name: '理由', check: checkAuditReason, max: AUDIT_REASON_MAX },
      { name: '肩書き', check: checkAdminTitle, max: ADMIN_TITLE_MAX },
    ])(
      '任意の$nameは空を受け付け、前後の空白を除いて上限の文字数までを受け付ける',
      ({ check, max }) => {
        expect(check('')).toBeUndefined();
        expect(check(` ${'あ'.repeat(max)} `)).toBeUndefined();
        expect(check('あ'.repeat(max + 1))).toBe('too-long');
      },
    );
  });
});
