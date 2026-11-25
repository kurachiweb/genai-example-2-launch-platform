import { describe, expect, test } from 'bun:test';

import type { QuarantineReason } from '../../../../common-lib/moderation/moderation-labels.ts';
import type { QuarantinedImageOperation } from '../shared/moderation-messages.ts';
import {
  quarantinedImageOperationsOf,
  quarantinedImageOwnerLabel,
} from './quarantined-image-view.ts';

describe('quarantinedImageOperationsOf', () => {
  test.each<
    readonly [
      string,
      readonly QuarantineReason[],
      readonly QuarantinedImageOperation[],
    ]
  >([
    [
      '自動判定だけなら公開承認と公開拒否',
      ['auto'],
      ['image.approve', 'image.reject'],
    ],
    [
      '管理者操作だけなら隔離の解除と削除',
      ['admin_action'],
      ['image.release', 'image.delete'],
    ],
    [
      '自動判定と管理者操作を両方持てば、両方の理由の操作を公開承認・公開拒否・隔離の解除・削除の順に並べる',
      ['admin_action', 'auto'],
      ['image.approve', 'image.reject', 'image.release', 'image.delete'],
    ],
    ['非公開化だけなら削除だけ', ['product_hidden'], ['image.delete']],
    ['ユーザー停止だけなら削除だけ', ['user_suspended'], ['image.delete']],
    [
      '非公開化とユーザー停止だけなら削除だけ',
      ['product_hidden', 'user_suspended'],
      ['image.delete'],
    ],
    [
      '自動判定と非公開化なら、非公開化の理由は画像の操作で外さず自動判定の操作だけ',
      ['product_hidden', 'auto'],
      ['image.approve', 'image.reject'],
    ],
    ['隔離理由が無ければ操作は無い', [], []],
  ])('%s', (_, reasons, expected) => {
    expect(quarantinedImageOperationsOf(reasons)).toStrictEqual(expected);
  });
});

describe('quarantinedImageOwnerLabel', () => {
  test('利用者はニックネームとハンドル', () => {
    expect(
      quarantinedImageOwnerLabel({
        kind: 'user',
        id: '01KA0VSER00000000000000001',
        nickname: 'サンプル太郎',
        handle: 'maker_ai',
      }),
    ).toBe('サンプル太郎(@maker_ai)');
  });

  test('管理者はニックネームに管理者の印', () => {
    expect(
      quarantinedImageOwnerLabel({
        kind: 'admin',
        id: '01KA0ADM1N0000000000000001',
        nickname: '運営サンプル',
        handle: null,
      }),
    ).toBe('運営サンプル(管理者)');
  });

  test('保有者を持たない画像はシステム', () => {
    expect(quarantinedImageOwnerLabel(null)).toBe('システム');
  });

  test.each([
    ['物理削除された利用者', 'user'],
    ['削除された管理者', 'admin'],
  ])('表示名を引けない保有者(%s)は表示できない利用者', (_, kind) => {
    expect(
      quarantinedImageOwnerLabel({
        kind,
        id: '01KA0VSER00000000000000009',
        nickname: null,
        handle: null,
      }),
    ).toBe('表示できない利用者');
  });
});
