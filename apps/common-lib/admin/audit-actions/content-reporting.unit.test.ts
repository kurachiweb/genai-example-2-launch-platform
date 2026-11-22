import { describe, expect, test } from 'bun:test';

import { createAuditActionCatalog } from '../audit-action.ts';
import {
  REPORT_CATEGORY_CREATE_ACTION,
  REPORT_CATEGORY_DELETE_ACTION,
  REPORT_CATEGORY_RENAME_ACTION,
  REPORT_INQUIRE_ACTION,
  REPORT_REJECT_ACTION,
  REPORT_RESOLVE_ACTION,
  REPORT_STATUS_CHANGE_ACTION,
  REPORTING_AUDIT_ACTIONS,
} from './content-reporting.ts';
import { AUDIT_ACTIONS } from './index.ts';

const PERSONAL_DETAIL_KEY_PATTERN =
  /name|nickname|body|message|email|mail|contact|content|text|reason/iu;

const EXPECTED_ACTIONS = [
  [
    REPORT_STATUS_CHANGE_ACTION,
    'report.status-change',
    '通報の対応ステータスの変更',
    'report',
    'optional',
    ['fromStatus', 'toStatus'],
  ],
  [
    REPORT_RESOLVE_ACTION,
    'report.resolve',
    '通報への対応(対応済)',
    'report',
    'required',
    ['resolution', 'mode', 'fromStatus'],
  ],
  [
    REPORT_REJECT_ACTION,
    'report.reject',
    '通報の却下',
    'report',
    'required',
    ['mode', 'fromStatus'],
  ],
  [
    REPORT_INQUIRE_ACTION,
    'report.inquire',
    '権利侵害の照会',
    'report',
    'optional',
    [],
  ],
  [
    REPORT_CATEGORY_CREATE_ACTION,
    'report-category.create',
    '通報カテゴリの追加',
    'category',
    'optional',
    [],
  ],
  [
    REPORT_CATEGORY_RENAME_ACTION,
    'report-category.rename',
    '通報カテゴリの名前の変更',
    'category',
    'optional',
    [],
  ],
  [
    REPORT_CATEGORY_DELETE_ACTION,
    'report-category.delete',
    '通報カテゴリの削除',
    'category',
    'optional',
    ['reassignedCount'],
  ],
] as const;

describe('通報の操作の種別', () => {
  test.each(
    EXPECTED_ACTIONS.map(
      ([action, name, label, targetKind, reason, detailKeys]) =>
        [name, label, targetKind, reason, detailKeys, action] as const,
    ),
  )(
    '%sは表示名「%s」・対象の種類%s・理由の要否%sで、詳細の鍵%pを持ち、対象は1件まで',
    (name, label, targetKind, reason, detailKeys, action) => {
      expect(action).toEqual({
        name,
        label,
        targetKind,
        reason,
        detailKeys: [...detailKeys],
        maxTargets: 1,
      });
    },
  );

  test('対応済と却下は操作か手での変更かの区別と変更前の状態を詳細に持ち、対応済は措置も持つ', () => {
    expect(REPORT_RESOLVE_ACTION.detailKeys).toContain('mode');
    expect(REPORT_RESOLVE_ACTION.detailKeys).toContain('fromStatus');
    expect(REPORT_RESOLVE_ACTION.detailKeys).toContain('resolution');
    expect(REPORT_REJECT_ACTION.detailKeys).toContain('mode');
    expect(REPORT_REJECT_ACTION.detailKeys).toContain('fromStatus');
    expect(REPORT_REJECT_ACTION.detailKeys).not.toContain('resolution');
  });

  test('利用者を対象にしない', () => {
    for (const action of REPORTING_AUDIT_ACTIONS) {
      expect(action.targetKind).not.toBe('user');
    }
  });
});

describe('REPORTING_AUDIT_ACTIONS', () => {
  test('本specの7種別を状態の変更・対応済・却下・照会・カテゴリの追加・名前の変更・削除の順に持つ', () => {
    expect(REPORTING_AUDIT_ACTIONS).toEqual(
      EXPECTED_ACTIONS.map(([action]) => action),
    );
  });

  test.each(REPORTING_AUDIT_ACTIONS.map((action) => [action.name, action]))(
    '種別%sは名前・本文・メールアドレス・照会の内容・申出者の理由を入れる詳細の鍵を持たない',
    (_name, action) => {
      for (const key of action.detailKeys) {
        expect(key).not.toMatch(PERSONAL_DETAIL_KEY_PATTERN);
      }
    },
  );

  test('例外なくカタログに登録できる', () => {
    expect(() =>
      createAuditActionCatalog(REPORTING_AUDIT_ACTIONS),
    ).not.toThrow();
  });

  test.each(REPORTING_AUDIT_ACTIONS.map((action) => [action.name, action]))(
    '種別%sは操作種別の集約点に加わり、集約した全種別と合わせても名前が重複せずに引ける',
    (name, action) => {
      expect(AUDIT_ACTIONS).toContain(action);
      expect(createAuditActionCatalog(AUDIT_ACTIONS).find(name)).toBe(action);
    },
  );

  test('集約した全種別の名前は重複しない', () => {
    const names = AUDIT_ACTIONS.map((action) => action.name);
    expect(new Set(names).size).toBe(names.length);
  });

  test('一覧と各定義は凍結されている', () => {
    expect(Object.isFrozen(REPORTING_AUDIT_ACTIONS)).toBe(true);
    for (const action of REPORTING_AUDIT_ACTIONS) {
      expect(Object.isFrozen(action)).toBe(true);
      expect(Object.isFrozen(action.detailKeys)).toBe(true);
    }
  });
});
