import { describe, expect, test } from 'bun:test';

import { createAuditActionCatalog } from '../audit-action.ts';
import {
  INQUIRY_AUDIT_ACTIONS,
  INQUIRY_CATEGORY_CREATE_ACTION,
  INQUIRY_CATEGORY_DELETE_ACTION,
  INQUIRY_CATEGORY_RENAME_ACTION,
  INQUIRY_REPLY_ACTION,
  INQUIRY_STATUS_CHANGE_ACTION,
} from './inquiry-chat.ts';

const PERSONAL_DETAIL_KEY_PATTERN = /name|nickname|body|message|email|mail/iu;

describe('問い合わせの操作の種別', () => {
  test('返信は対象が問い合わせ1件で理由が任意、詳細を持たない', () => {
    expect(INQUIRY_REPLY_ACTION).toEqual({
      name: 'inquiry.reply',
      label: '問い合わせへの返信',
      targetKind: 'inquiry',
      reason: 'optional',
      detailKeys: [],
      maxTargets: 1,
    });
  });

  test('ステータスの変更は対象が問い合わせ1件で理由が任意、詳細に種別と変更前後のステータスを持つ', () => {
    expect(INQUIRY_STATUS_CHANGE_ACTION).toEqual({
      name: 'inquiry.status-change',
      label: '対応ステータスの変更',
      targetKind: 'inquiry',
      reason: 'optional',
      detailKeys: ['kind', 'fromStatus', 'toStatus'],
      maxTargets: 1,
    });
  });
});

describe('問い合わせカテゴリの操作の種別', () => {
  test('追加は対象がカテゴリ1件で理由が任意、詳細を持たない', () => {
    expect(INQUIRY_CATEGORY_CREATE_ACTION).toEqual({
      name: 'inquiry-category.create',
      label: '問い合わせカテゴリの追加',
      targetKind: 'category',
      reason: 'optional',
      detailKeys: [],
      maxTargets: 1,
    });
  });

  test('名前の変更は対象がカテゴリ1件で理由が任意、詳細を持たない', () => {
    expect(INQUIRY_CATEGORY_RENAME_ACTION).toEqual({
      name: 'inquiry-category.rename',
      label: '問い合わせカテゴリの名前の変更',
      targetKind: 'category',
      reason: 'optional',
      detailKeys: [],
      maxTargets: 1,
    });
  });

  test('削除は対象がカテゴリ1件で理由が任意、詳細に付け替えの件数を持つ', () => {
    expect(INQUIRY_CATEGORY_DELETE_ACTION).toEqual({
      name: 'inquiry-category.delete',
      label: '問い合わせカテゴリの削除',
      targetKind: 'category',
      reason: 'optional',
      detailKeys: ['reassignedCount'],
      maxTargets: 1,
    });
  });
});

describe('INQUIRY_AUDIT_ACTIONS', () => {
  test('本specの5種別を返信・ステータスの変更・カテゴリの追加・名前の変更・削除の順に持つ', () => {
    expect(INQUIRY_AUDIT_ACTIONS).toEqual([
      INQUIRY_REPLY_ACTION,
      INQUIRY_STATUS_CHANGE_ACTION,
      INQUIRY_CATEGORY_CREATE_ACTION,
      INQUIRY_CATEGORY_RENAME_ACTION,
      INQUIRY_CATEGORY_DELETE_ACTION,
    ]);
  });

  test.each(INQUIRY_AUDIT_ACTIONS.map((action) => [action.name, action]))(
    '種別%sは名前・本文・メールアドレスを入れる詳細の鍵を持たない',
    (_name, action) => {
      for (const key of action.detailKeys) {
        expect(key).not.toMatch(PERSONAL_DETAIL_KEY_PATTERN);
      }
    },
  );

  test('例外なくカタログに登録できる', () => {
    expect(() => createAuditActionCatalog(INQUIRY_AUDIT_ACTIONS)).not.toThrow();
  });

  test('一覧と各定義は凍結されている', () => {
    expect(Object.isFrozen(INQUIRY_AUDIT_ACTIONS)).toBe(true);
    for (const action of INQUIRY_AUDIT_ACTIONS) {
      expect(Object.isFrozen(action)).toBe(true);
    }
  });
});
