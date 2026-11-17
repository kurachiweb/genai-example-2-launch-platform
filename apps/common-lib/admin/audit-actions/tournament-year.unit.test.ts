import { describe, expect, test } from 'bun:test';

import { createAuditActionCatalog } from '../audit-action.ts';
import { AUDIT_ACTIONS } from './index.ts';
import {
  TOURNAMENT_YEAR_AUDIT_ACTIONS,
  YEAR_FINAL_DATE_UPDATE_ACTION,
} from './tournament-year.ts';

const PERSONAL_DETAIL_KEY_PATTERN =
  /name|nickname|body|message|email|mail|address/iu;

describe('Yearトーナメントの決勝実施日の操作の種別', () => {
  test('決勝実施日の変更は対象が設定1件で理由が任意、詳細に年・変更前後の日付・変更前の出どころを持つ', () => {
    expect(YEAR_FINAL_DATE_UPDATE_ACTION).toEqual({
      name: 'year-final-date.update',
      label: 'Yearトーナメント決勝実施日の変更',
      targetKind: 'setting',
      reason: 'optional',
      detailKeys: ['year', 'fromDate', 'toDate', 'fromSource'],
      maxTargets: 1,
    });
  });
});

describe('TOURNAMENT_YEAR_AUDIT_ACTIONS', () => {
  test('本specの1種別だけを持つ', () => {
    expect(TOURNAMENT_YEAR_AUDIT_ACTIONS).toEqual([
      YEAR_FINAL_DATE_UPDATE_ACTION,
    ]);
  });

  test.each(
    TOURNAMENT_YEAR_AUDIT_ACTIONS.map((action) => [action.name, action]),
  )(
    '種別%sは名前・住所・本文・メールアドレスを入れる詳細の鍵を持たない',
    (_name, action) => {
      for (const key of action.detailKeys) {
        expect(key).not.toMatch(PERSONAL_DETAIL_KEY_PATTERN);
      }
    },
  );

  test('例外なくカタログに登録できる', () => {
    expect(() =>
      createAuditActionCatalog(TOURNAMENT_YEAR_AUDIT_ACTIONS),
    ).not.toThrow();
  });

  test('操作種別の集約点に加わり、集約した全種別と合わせても例外なくカタログに登録できる', () => {
    expect(AUDIT_ACTIONS).toContain(YEAR_FINAL_DATE_UPDATE_ACTION);
    expect(
      createAuditActionCatalog(AUDIT_ACTIONS).find('year-final-date.update'),
    ).toBe(YEAR_FINAL_DATE_UPDATE_ACTION);
  });

  test('一覧と各定義は凍結されている', () => {
    expect(Object.isFrozen(TOURNAMENT_YEAR_AUDIT_ACTIONS)).toBe(true);
    for (const action of TOURNAMENT_YEAR_AUDIT_ACTIONS) {
      expect(Object.isFrozen(action)).toBe(true);
    }
  });
});
