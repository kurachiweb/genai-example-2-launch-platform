import { describe, expect, test } from 'bun:test';

import { createAuditActionCatalog } from '../audit-action.ts';
import { AUDIT_ACTIONS } from './index.ts';
import {
  NOTIFICATION_AUDIT_ACTIONS,
  NOTIFICATION_SENDER_UPDATE_ACTION,
} from './notifications.ts';

const PERSONAL_DETAIL_KEY_PATTERN =
  /name|nickname|body|message|email|mail|address/iu;

describe('通知メールの送信者情報の操作の種別', () => {
  test('送信者情報の変更は対象が設定1件で理由が任意、詳細に変更した項目の名前を持つ', () => {
    expect(NOTIFICATION_SENDER_UPDATE_ACTION).toEqual({
      name: 'notification-sender.update',
      label: '通知メールの送信者情報の変更',
      targetKind: 'setting',
      reason: 'optional',
      detailKeys: ['fields'],
      maxTargets: 1,
    });
  });
});

describe('NOTIFICATION_AUDIT_ACTIONS', () => {
  test('本specの1種別だけを持つ', () => {
    expect(NOTIFICATION_AUDIT_ACTIONS).toEqual([
      NOTIFICATION_SENDER_UPDATE_ACTION,
    ]);
  });

  test.each(NOTIFICATION_AUDIT_ACTIONS.map((action) => [action.name, action]))(
    '種別%sは名前・住所・メールアドレスを入れる詳細の鍵を持たない',
    (_name, action) => {
      for (const key of action.detailKeys) {
        expect(key).not.toMatch(PERSONAL_DETAIL_KEY_PATTERN);
      }
    },
  );

  test('例外なくカタログに登録できる', () => {
    expect(() =>
      createAuditActionCatalog(NOTIFICATION_AUDIT_ACTIONS),
    ).not.toThrow();
  });

  test('操作種別の集約点に加わり、集約した全種別と合わせても例外なくカタログに登録できる', () => {
    expect(AUDIT_ACTIONS).toContain(NOTIFICATION_SENDER_UPDATE_ACTION);
    expect(
      createAuditActionCatalog(AUDIT_ACTIONS).find(
        'notification-sender.update',
      ),
    ).toBe(NOTIFICATION_SENDER_UPDATE_ACTION);
  });

  test('一覧と各定義は凍結されている', () => {
    expect(Object.isFrozen(NOTIFICATION_AUDIT_ACTIONS)).toBe(true);
    for (const action of NOTIFICATION_AUDIT_ACTIONS) {
      expect(Object.isFrozen(action)).toBe(true);
    }
  });
});
