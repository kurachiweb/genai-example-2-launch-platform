import { describe, expect, test } from 'bun:test';

import { AUDIT_REASON_MAX } from '../../../common-lib/admin/admin-input-rules.ts';
import {
  ADMIN_FILTER_LABEL,
  ADMIN_PAGINATION_LABEL,
  APPLY_FILTER_LABEL,
  AUDITED_ACTION_NOTICE,
  CONFIRM_ACTION_CANCEL_LABEL,
  NEXT_PAGE_LABEL,
  OPTIONAL_REASON_LABEL,
  PREVIOUS_PAGE_LABEL,
  REASON_PERSONAL_INFORMATION_NOTICE,
  REASON_REQUIRED_MESSAGE,
  REASON_TOO_LONG_MESSAGE,
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
});
