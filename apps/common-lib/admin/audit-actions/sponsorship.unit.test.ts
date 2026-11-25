import { describe, expect, test } from 'bun:test';

import { createAuditActionCatalog } from '../audit-action.ts';
import { AUDIT_ACTIONS } from './index.ts';
import {
  SPONSORSHIP_AUDIT_ACTIONS,
  SPONSORSHIP_TERMINATE_ACTION,
} from './sponsorship.ts';

const PERSONAL_DETAIL_KEY_PATTERN =
  /name|nickname|body|message|email|mail|address|reason/iu;

describe('スポンサー広告の強制終了の操作の種別', () => {
  test('強制終了は対象が申込1件で理由が必須、詳細に未掲載日数・返金目安額・表示停止日数・表示停止の返金額を持つ', () => {
    expect(SPONSORSHIP_TERMINATE_ACTION).toEqual({
      name: 'sponsorship.terminate',
      label: 'スポンサー広告の強制終了',
      targetKind: 'sponsorship',
      reason: 'required',
      detailKeys: [
        'unexposedDays',
        'refundEstimate',
        'stoppedDays',
        'stopRefundAmount',
      ],
      maxTargets: 1,
    });
  });
});

describe('SPONSORSHIP_AUDIT_ACTIONS', () => {
  test('本specの1種別だけを持つ', () => {
    expect(SPONSORSHIP_AUDIT_ACTIONS).toEqual([SPONSORSHIP_TERMINATE_ACTION]);
  });

  test.each(SPONSORSHIP_AUDIT_ACTIONS.map((action) => [action.name, action]))(
    '種別%sは名前・住所・本文・メールアドレス・理由を入れる詳細の鍵を持たない',
    (_name, action) => {
      for (const key of action.detailKeys) {
        expect(key).not.toMatch(PERSONAL_DETAIL_KEY_PATTERN);
      }
    },
  );

  test('例外なくカタログに登録できる', () => {
    expect(() =>
      createAuditActionCatalog(SPONSORSHIP_AUDIT_ACTIONS),
    ).not.toThrow();
  });

  test('操作種別の集約点に加わり、集約した全種別と合わせても例外なくカタログに登録できる', () => {
    expect(AUDIT_ACTIONS).toContain(SPONSORSHIP_TERMINATE_ACTION);
    expect(
      createAuditActionCatalog(AUDIT_ACTIONS).find('sponsorship.terminate'),
    ).toBe(SPONSORSHIP_TERMINATE_ACTION);
  });

  test('一覧と各定義は凍結されている', () => {
    expect(Object.isFrozen(SPONSORSHIP_AUDIT_ACTIONS)).toBe(true);
    for (const action of SPONSORSHIP_AUDIT_ACTIONS) {
      expect(Object.isFrozen(action)).toBe(true);
    }
  });
});
