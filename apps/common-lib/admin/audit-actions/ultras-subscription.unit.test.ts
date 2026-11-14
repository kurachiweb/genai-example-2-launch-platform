import { describe, expect, test } from 'bun:test';

import { createAuditActionCatalog } from '../audit-action.ts';
import {
  ULTRAS_AUDIT_ACTIONS,
  ULTRAS_PROMOTION_UPDATE_ACTION,
} from './ultras-subscription.ts';

const PERSONAL_DETAIL_KEY_PATTERN = /name|nickname|body|message|email|mail/iu;

describe('Ultras導線の機能フラグの操作の種別', () => {
  test('機能フラグの変更は対象が設定1件で理由が任意、詳細に変更後の値を持つ', () => {
    expect(ULTRAS_PROMOTION_UPDATE_ACTION).toEqual({
      name: 'ultras-promotion.update',
      label: 'Ultras導線の機能フラグの変更',
      targetKind: 'setting',
      reason: 'optional',
      detailKeys: ['enabled'],
      maxTargets: 1,
    });
  });
});

describe('ULTRAS_AUDIT_ACTIONS', () => {
  test('本specの1種別だけを持つ', () => {
    expect(ULTRAS_AUDIT_ACTIONS).toEqual([ULTRAS_PROMOTION_UPDATE_ACTION]);
  });

  test.each(ULTRAS_AUDIT_ACTIONS.map((action) => [action.name, action]))(
    '種別%sは名前・本文・メールアドレスを入れる詳細の鍵を持たない',
    (_name, action) => {
      for (const key of action.detailKeys) {
        expect(key).not.toMatch(PERSONAL_DETAIL_KEY_PATTERN);
      }
    },
  );

  test('例外なくカタログに登録できる', () => {
    expect(() => createAuditActionCatalog(ULTRAS_AUDIT_ACTIONS)).not.toThrow();
  });

  test('一覧と各定義は凍結されている', () => {
    expect(Object.isFrozen(ULTRAS_AUDIT_ACTIONS)).toBe(true);
    for (const action of ULTRAS_AUDIT_ACTIONS) {
      expect(Object.isFrozen(action)).toBe(true);
    }
  });
});
