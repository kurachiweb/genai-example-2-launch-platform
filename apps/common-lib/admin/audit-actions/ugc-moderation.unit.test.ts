import { describe, expect, test } from 'bun:test';

import { MODERATION_ACTIONS } from '../../moderation/moderation-actions.ts';
import { MODERATION_ACTION_LABELS } from '../../moderation/moderation-labels.ts';
import { createAuditActionCatalog } from '../audit-action.ts';
import { AUDIT_ACTIONS } from './index.ts';
import {
  MODERATION_AUDIT_ACTION_DEFINITIONS,
  MODERATION_AUDIT_ACTIONS,
} from './ugc-moderation.ts';

const EXPECTED_ACTIONS = [
  ['user.suspend', 'ユーザーの停止', 'user', 'required'],
  ['user.unsuspend', 'ユーザーの停止解除', 'user', 'required'],
  ['user.administrative-withdraw', 'ユーザーの代理の退会', 'user', 'required'],
  ['product.hide', 'プロダクトの非公開化', 'product', 'required'],
  ['product.unhide', 'プロダクトの復元', 'product', 'required'],
  ['comment.hide', 'コメントの非公開化', 'comment', 'required'],
  ['comment.unhide', 'コメントの復元', 'comment', 'required'],
  ['rating.invalidate', '評価の無効化', 'rating', 'required'],
  ['rating.revalidate', '評価の無効化の取り消し', 'rating', 'required'],
  ['image.approve', '画像の公開承認', 'image', 'optional'],
  ['image.quarantine', '画像の隔離', 'image', 'optional'],
  ['image.release', '画像の隔離の解除', 'image', 'optional'],
  ['image.delete', '画像の削除', 'image', 'optional'],
] as const;

describe('措置の操作の種別', () => {
  test.each(EXPECTED_ACTIONS)(
    '%sは表示名「%s」・対象の種類%s・理由の要否%sで、対象は1件まで、詳細の鍵を持たない',
    (name, label, targetKind, reason) => {
      expect(MODERATION_AUDIT_ACTION_DEFINITIONS[name]).toEqual({
        name,
        label,
        targetKind,
        reason,
        detailKeys: [],
        maxTargets: 1,
      });
    },
  );

  test('種別の名前は措置の種類と同じで、表示名は措置の表示名と同じ', () => {
    for (const action of MODERATION_ACTIONS) {
      const definition = MODERATION_AUDIT_ACTION_DEFINITIONS[action];
      expect(definition.name).toBe(action);
      expect(definition.label).toBe(MODERATION_ACTION_LABELS[action]);
    }
  });
});

describe('MODERATION_AUDIT_ACTIONS', () => {
  test('本specの13種別を措置の種類の順に持つ', () => {
    expect(MODERATION_AUDIT_ACTIONS.map((action) => action.name)).toEqual(
      EXPECTED_ACTIONS.map(([name]) => name),
    );
    expect(MODERATION_AUDIT_ACTIONS).toEqual(
      MODERATION_ACTIONS.map(
        (action) => MODERATION_AUDIT_ACTION_DEFINITIONS[action],
      ),
    );
  });

  test('例外なくカタログに登録できる', () => {
    expect(() =>
      createAuditActionCatalog(MODERATION_AUDIT_ACTIONS),
    ).not.toThrow();
  });

  test.each(MODERATION_AUDIT_ACTIONS.map((action) => [action.name, action]))(
    '種別%sは操作種別の集約点に加わり、集約した全種別と合わせても名前が重複せずに引ける',
    (name, action) => {
      expect(AUDIT_ACTIONS).toContain(action);
      expect(createAuditActionCatalog(AUDIT_ACTIONS).find(name)).toBe(action);
    },
  );

  test('一覧と各定義は凍結されている', () => {
    expect(Object.isFrozen(MODERATION_AUDIT_ACTIONS)).toBe(true);
    expect(Object.isFrozen(MODERATION_AUDIT_ACTION_DEFINITIONS)).toBe(true);
    for (const action of MODERATION_AUDIT_ACTIONS) {
      expect(Object.isFrozen(action)).toBe(true);
      expect(Object.isFrozen(action.detailKeys)).toBe(true);
    }
  });
});
